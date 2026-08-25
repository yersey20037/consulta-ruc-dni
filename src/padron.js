'use strict';

/**
 * Padron Reducido de SUNAT: descarga, carga a SQLite y consulta local.
 *
 * El Padron Reducido es un ZIP que SUNAT publica a diario con todos los
 * contribuyentes inscritos. Es descarga directa: sin token, sin captcha.
 *
 *   http://www2.sunat.gob.pe/padron_reducido_ruc.zip  (~391 MB, ~18M filas)
 *
 * El archivo interno es texto separado por '|' en Latin-1, con cabecera:
 *   RUC|NOMBRE O RAZON SOCIAL|ESTADO|CONDICION DE DOMICILIO|UBIGEO|
 *   TIPO DE VIA|NOMBRE DE VIA|CODIGO DE ZONA|TIPO DE ZONA|NUMERO|
 *   INTERIOR|LOTE|DEPARTAMENTO|MANZANA|KILOMETRO
 *
 * Los RUC que empiezan en '10' son personas naturales y llevan el DNI
 * embebido en las posiciones 3-10, lo que permite consultar por DNI a
 * partir de datos publicos de SUNAT.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const readline = require('readline');
const { DatabaseSync } = require('node:sqlite');
require('./config');            // carga el .env antes de leer PADRON_*
const { ubicacion } = require('./ubigeo');

const URL_PADRON = process.env.PADRON_URL ||
  'http://www2.sunat.gob.pe/padron_reducido_ruc.zip';

const DIR_DATOS = process.env.PADRON_DIR ||
  path.join(__dirname, '..', 'datos');

const RUTA_DB = path.join(DIR_DATOS, 'padron.db');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Filas por lote en la insercion. Mas alto = mas rapido, mas RAM.
const LOTE = 20000;

/* ================================================================
 *  CONSULTA
 * ================================================================ */

let db = null;
let qRuc = null;
let qDni = null;

function abrir() {
  if (db) return db;
  if (!fs.existsSync(RUTA_DB)) {
    const e = new Error(
      'El padron no esta cargado. Ejecute: npm run actualizar-padron'
    );
    e.code = 'PADRON_AUSENTE';
    throw e;
  }
  db = new DatabaseSync(RUTA_DB, { readOnly: true });
  db.exec('PRAGMA cache_size = -64000');   // 64 MB de cache de paginas
  qRuc = db.prepare('SELECT * FROM padron WHERE ruc = ?');
  qDni = db.prepare('SELECT * FROM padron WHERE dni = ?');
  return db;
}

function cerrar() {
  if (db) {
    db.close();
    db = null;
    qRuc = null;
    qDni = null;
  }
}

/**
 * Reabre la base. Se llama tras una actualizacion para que el proceso
 * en marcha empiece a leer el archivo nuevo sin reiniciarse.
 */
function recargar() {
  cerrar();
  return abrir();
}

/**
 * Devuelve los datos de la empresa, o null si el RUC no existe.
 */
function consultarRuc(ruc) {
  abrir();
  const f = qRuc.get(ruc);
  return f ? aEmpresa(f) : null;
}

/**
 * Consulta por DNI usando el RUC de persona natural (10 + DNI + digito).
 * Solo encuentra personas que tengan RUC; un DNI sin RUC no esta en el
 * padron y devuelve null (el servidor responde 404).
 */
function consultarDni(dni) {
  abrir();
  const f = qDni.get(dni);
  if (!f) return null;
  return {
    dni,
    // El padron trae el nombre completo en un solo campo, ya en el orden
    // "APELLIDOS NOMBRES". Se entrega como apellidoPaterno para que
    // formatoDni() lo concatene sin alterar el orden.
    apellidoPaterno: f.nombre || '',
    apellidoMaterno: '',
    nombres: '',
  };
}

function aEmpresa(f) {
  // El padron trae la direccion desarmada en columnas; se rearma en una
  // sola cadena para que parseDireccion() la vuelva a separar con las
  // mismas reglas que el resto del sistema.
  const partes = [];
  const agregar = (pre, val) => {
    const v = (val || '').trim();
    if (v && v !== '-') partes.push(pre ? `${pre} ${v}` : v);
  };

  agregar('', f.tipo_via);
  agregar('', f.nombre_via);
  agregar('NRO.', f.numero);
  agregar('INT.', f.interior);
  // MZA antes que LOTE: es el orden en que SUNAT escribe las direcciones.
  agregar('MZA.', f.manzana);
  agregar('LOTE.', f.lote);
  agregar('DPTO.', f.dpto);
  agregar('KM.', f.kilometro);
  agregar('', f.cod_zona);
  agregar('', f.tipo_zona);

  return {
    razonSocial: f.nombre || '',
    estado: f.estado || '',
    condicion: f.condicion || '',
    ubigeo: f.ubigeo && f.ubigeo !== '-' ? f.ubigeo : '',
    direccion: partes.join(' '),
    // OJO: la columna DEPARTAMENTO del padron es el departamento de la
    // vivienda ("DPTO. 403"), no la region. La ubicacion geografica solo
    // viene como ubigeo, que se traduce con la tabla de src/ubigeo.js.
    ...ubicacion(f.ubigeo),
  };
}

/** Metadatos de la ultima carga: cuando se hizo y cuantas filas entraron. */
function estado() {
  try {
    abrir();
    const meta = db.prepare('SELECT clave, valor FROM meta').all();
    const m = {};
    for (const r of meta) m[r.clave] = r.valor;
    return {
      cargado: true,
      filas: Number(m.filas || 0),
      actualizado_en: m.actualizado_en || null,
      tamano_mb: Math.round(fs.statSync(RUTA_DB).size / 1e6),
    };
  } catch (e) {
    return { cargado: false, error: e.message };
  }
}

/* ================================================================
 *  DESCARGA Y CARGA
 * ================================================================ */

function descargar(url, destino, onProgreso) {
  return new Promise((resolve, reject) => {
    const cliente = url.startsWith('https:') ? https : http;
    const req = cliente.get(
      url,
      { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(descargar(res.headers.location, destino, onProgreso));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`SUNAT respondio ${res.statusCode} al descargar el padron`));
        }

        const total = Number(res.headers['content-length'] || 0);
        let leido = 0;
        let ultimo = 0;

        const salida = fs.createWriteStream(destino);
        res.on('data', (c) => {
          leido += c.length;
          const pct = total ? Math.floor((leido / total) * 100) : 0;
          if (onProgreso && pct >= ultimo + 5) {
            ultimo = pct;
            onProgreso(pct, leido, total);
          }
        });
        res.pipe(salida);
        salida.on('finish', () => salida.close(() => resolve({ bytes: leido })));
        salida.on('error', reject);
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(20 * 60 * 1000, () => req.destroy(new Error('Timeout descargando el padron')));
  });
}

/**
 * Lee el primer archivo del ZIP como stream, sin descomprimirlo a disco.
 * El padron trae un unico .txt con metodo deflate (8) o almacenado (0).
 */
function abrirEntradaZip(rutaZip) {
  const fd = fs.openSync(rutaZip, 'r');
  const cab = Buffer.alloc(30);
  fs.readSync(fd, cab, 0, 30, 0);

  if (cab.readUInt32LE(0) !== 0x04034b50) {
    fs.closeSync(fd);
    throw new Error('El archivo descargado no es un ZIP valido');
  }

  const metodo = cab.readUInt16LE(8);
  const nLen = cab.readUInt16LE(26);
  const mLen = cab.readUInt16LE(28);
  const inicio = 30 + nLen + mLen;

  const nombre = Buffer.alloc(nLen);
  fs.readSync(fd, nombre, 0, nLen, 30);
  fs.closeSync(fd);

  const crudo = fs.createReadStream(rutaZip, { start: inicio });
  const stream = metodo === 8 ? crudo.pipe(zlib.createInflateRaw()) : crudo;

  return { stream, nombre: nombre.toString('latin1'), metodo };
}

/**
 * Carga el ZIP a una base nueva y la intercambia por la vigente al
 * terminar. El servicio sigue respondiendo con la base anterior mientras
 * dura la carga, y el cambio es atomico (rename).
 */
async function cargar(rutaZip, log = console.log) {
  fs.mkdirSync(DIR_DATOS, { recursive: true });

  const tmpDb = RUTA_DB + '.nuevo';
  for (const f of [tmpDb, tmpDb + '-journal']) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  const nueva = new DatabaseSync(tmpDb);
  nueva.exec('PRAGMA journal_mode = OFF');
  nueva.exec('PRAGMA synchronous = OFF');
  nueva.exec(`CREATE TABLE padron(
    ruc TEXT PRIMARY KEY, nombre TEXT, estado TEXT, condicion TEXT,
    ubigeo TEXT, tipo_via TEXT, nombre_via TEXT, cod_zona TEXT,
    tipo_zona TEXT, numero TEXT, interior TEXT, lote TEXT,
    dpto TEXT, manzana TEXT, kilometro TEXT, dni TEXT
  ) WITHOUT ROWID`);
  nueva.exec('CREATE TABLE meta(clave TEXT PRIMARY KEY, valor TEXT)');

  const ins = nueva.prepare(
    'INSERT OR REPLACE INTO padron VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  );

  const { stream, nombre } = abrirEntradaZip(rutaZip);
  log(`  archivo interno: ${nombre}`);

  // El padron viene en Latin-1: sin decodificarlo asi, la N y las tildes
  // llegan corruptas a la base y sanear() ya no puede arreglarlas.
  const rl = readline.createInterface({
    input: stream.pipe(aLatin1()),
    crlfDelay: Infinity,
  });

  let n = 0;
  let saltadas = 0;
  let primera = true;
  const t0 = Date.now();

  nueva.exec('BEGIN');

  for await (const linea of rl) {
    if (primera) {                    // cabecera
      primera = false;
      if (/^RUC\|/i.test(linea)) continue;
    }
    if (!linea) continue;

    const p = campos(linea);
    if (!p) { saltadas++; continue; }

    const ruc = p[0];

    const dni = dniDeRuc(ruc);

    ins.run(
      ruc, t(p[1]), t(p[2]), t(p[3]), t(p[4]), t(p[5]), t(p[6]), t(p[7]),
      t(p[8]), t(p[9]), t(p[10]), t(p[11]), t(p[12]), t(p[13]), t(p[14]), dni
    );

    if (++n % LOTE === 0) {
      nueva.exec('COMMIT');
      nueva.exec('BEGIN');
      if (n % 1000000 === 0) log(`  ${n.toLocaleString('es-PE')} filas...`);
    }
  }

  nueva.exec('COMMIT');
  log(`  ${n.toLocaleString('es-PE')} filas insertadas en ${seg(t0)}s` +
      (saltadas ? ` (${saltadas} descartadas)` : ''));

  const t1 = Date.now();
  nueva.exec('CREATE INDEX idx_dni ON padron(dni) WHERE dni IS NOT NULL');
  log(`  indice de DNI creado en ${seg(t1)}s`);

  const meta = nueva.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)');
  meta.run('filas', String(n));
  meta.run('actualizado_en', new Date().toISOString());
  meta.run('origen', URL_PADRON);
  nueva.close();

  if (n === 0) {
    fs.unlinkSync(tmpDb);
    throw new Error('El padron llego vacio; se conserva la base anterior');
  }

  // El intercambio se hace aparte: cuando la carga corre en un proceso
  // hijo, quien tiene la base abierta es el SERVIDOR (el padre), y en
  // Windows un archivo abierto no se puede renombrar (EBUSY). Por eso el
  // hijo termina aqui, dejando la base nueva lista, y es el padre quien
  // cierra la suya y llama a intercambiar().
  return { filas: n, saltadas, listo: tmpDb };
}

/**
 * Pone la base recien cargada en su sitio. Debe llamarlo el proceso que
 * tiene la base abierta, porque cierra su conexion antes de renombrar.
 *
 * En Windows el rename falla si alguien mantiene el archivo abierto, asi
 * que se reintenta un momento: puede haber una consulta en vuelo soltando
 * el descriptor.
 */
function intercambiar(intentos = 10, esperaMs = 300) {
  const tmpDb = RUTA_DB + '.nuevo';
  if (!fs.existsSync(tmpDb)) {
    throw new Error('No hay ninguna base nueva pendiente de intercambiar');
  }

  cerrar();   // suelta el archivo en ESTE proceso

  const viejo = RUTA_DB + '.viejo';
  let ultimo = null;

  for (let i = 0; i < intentos; i++) {
    try {
      if (fs.existsSync(viejo)) fs.unlinkSync(viejo);
      if (fs.existsSync(RUTA_DB)) fs.renameSync(RUTA_DB, viejo);
      fs.renameSync(tmpDb, RUTA_DB);
      if (fs.existsSync(viejo)) {
        try { fs.unlinkSync(viejo); } catch { /* se borra en el proximo ciclo */ }
      }
      return true;
    } catch (e) {
      ultimo = e;
      // Si la vieja ya se aparto pero la nueva no entro, se deshace el paso
      // para no dejar al servicio sin base.
      if (!fs.existsSync(RUTA_DB) && fs.existsSync(viejo)) {
        try { fs.renameSync(viejo, RUTA_DB); } catch { /* se reintenta */ }
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, esperaMs);
    }
  }

  throw new Error(`No se pudo reemplazar la base tras ${intentos} intentos: ${ultimo && ultimo.message}`);
}

/** RUC 10 = persona natural: los digitos 3-10 son el DNI. Otros no llevan. */
function dniDeRuc(ruc) {
  return ruc.startsWith('10') ? ruc.slice(2, 10) : null;
}

const COLUMNAS = 15;

/**
 * Parte una linea del padron en sus 15 campos.
 *
 * Algunas razones sociales llevan un '|' dentro ("EBEN EZER | INGENIERIA
 * S.A.C."), lo que corre todas las columnas y guarda basura en la
 * direccion. Son poquisimas (3 de 18 millones), pero son empresas reales.
 *
 * El formato tiene un numero fijo de campos y el nombre es el unico que
 * puede contener el separador, asi que cuando sobran trozos se reconstruye:
 * el primero es el RUC, los 13 ultimos son las columnas de la direccion y
 * todo lo del medio es el nombre.
 *
 * Devuelve null si la linea no sirve.
 */
function campos(linea) {
  const t = linea.split('|');
  // Cada linea termina en '|', asi que el ultimo trozo viene vacio. No se
  // descarta aqui: en una linea con '|' dentro del nombre, ese hueco es
  // justo el margen que necesita el desplazamiento para cuadrar.
  if (t.length < COLUMNAS) return null;

  const ruc = t[0].trim();
  if (!/^\d{11}$/.test(ruc)) return null;

  // El ubigeo (columna 4) es el ancla: 6 digitos, o '-' en las personas
  // naturales. Si en esa posicion no hay un ubigeo, la razon social traia
  // uno o mas '|' y todas las columnas se corrieron a la derecha.
  const esUbigeo = (v) => /^\d{6}$/.test(v) || v === '-';

  // d = cuantos '|' de mas se comio el nombre (0 = linea bien formada).
  for (let d = 0; d + COLUMNAS <= t.length; d++) {
    if (!esUbigeo((t[4 + d] || '').trim())) continue;
    const nombre = t.slice(1, 2 + d).join('|').trim();
    // Tras el nombre quedan las 13 columnas restantes.
    const resto = t.slice(2 + d, 2 + d + (COLUMNAS - 2)).map((x) => x.trim());
    if (resto.length === COLUMNAS - 2) return [ruc, nombre, ...resto];
  }

  // Sin ancla fiable: se toma tal cual para no perder la fila.
  return t.slice(0, COLUMNAS).map((x) => x.trim());
}

const t = (s) => (s == null ? '' : String(s).trim());
const seg = (t0) => ((Date.now() - t0) / 1000).toFixed(1);

/** Transforma un stream de bytes Latin-1 en texto, respetando los cortes. */
function aLatin1() {
  const { Transform } = require('stream');
  const dec = new TextDecoder('latin1');
  return new Transform({
    transform(chunk, _enc, cb) { cb(null, dec.decode(chunk, { stream: true })); },
    flush(cb) { cb(null, dec.decode()); },
  });
}

/**
 * Actualizacion completa: descarga el ZIP a un temporal, lo carga y lo borra.
 */
async function actualizar(log = console.log) {
  fs.mkdirSync(DIR_DATOS, { recursive: true });
  const zip = path.join(os.tmpdir(), `padron_${Date.now()}.zip`);

  try {
    log(`Descargando ${URL_PADRON}`);
    const t0 = Date.now();
    const { bytes } = await descargar(URL_PADRON, zip, (pct, leido, total) => {
      log(`  ${pct}%  ${(leido / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`);
    });
    log(`  ${(bytes / 1e6).toFixed(0)} MB en ${seg(t0)}s`);

    log('Cargando a SQLite...');
    const t1 = Date.now();
    const r = await cargar(zip, log);
    log(`Listo: ${r.filas.toLocaleString('es-PE')} filas en ${seg(t1)}s`);

    return r;
  } finally {
    if (fs.existsSync(zip)) fs.unlinkSync(zip);
  }
}

module.exports = {
  _internos: { aEmpresa, dniDeRuc, campos },
  intercambiar,
  consultarRuc,
  consultarDni,
  estado,
  recargar,
  cerrar,
  cargar,
  descargar,
  actualizar,
  RUTA_DB,
  DIR_DATOS,
  URL_PADRON,
};
