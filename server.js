'use strict';

const http = require('http');
const cfg = require('./src/config');   // lee .env antes que nada
const padron = require('./src/padron');
const { programar } = require('./src/programador');
const compat = require('./src/compat');
const { formatoRuc, formatoDni } = require('./src/formato');

// ---------------- CONFIGURACION ----------------
// Todo sale de src/config.js, que lee el .env si existe.
const { PUERTO, SOLO_ASCII, TOKEN, HORA_ACTUALIZACION: HORA_PADRON } = cfg;

// Consultas identicas simultaneas comparten la misma peticion a SUNAT.
// Si tres cajeros piden el mismo RUC a la vez, SUNAT recibe una sola llamada.
const enVuelo = new Map();

const servidor = http.createServer(async (req, res) => {
  const inicio = Date.now();
  const url = new URL(req.url, 'http://localhost');
  const ruta = url.pathname.replace(/\/+$/, '') || '/';

  try {
    if (ruta === '/ping') {
      const e = padron.estado();
      return responder(res, 200, {
        success: true,
        message: 'ok',
        fecha: new Date().toISOString(),
        padron: e,
        actualizacion: tarea
          ? { hora: HORA_PADRON, corriendo: tarea.corriendo }
          : { hora: null },
      });
    }

    // Lanza la actualizacion ahora, sin esperar a la hora programada.
    // Responde de inmediato: la carga sigue en el proceso hijo.
    if (ruta === '/actualizar') {
      if (TOKEN && tokenRecibido(req, url) !== TOKEN) {
        return responder(res, 401, { success: false, message: 'Token invalido' });
      }
      if (!tarea) {
        return responder(res, 409, {
          success: false,
          message: 'La actualizacion automatica esta desactivada (HORA_ACTUALIZACION vacio)',
        });
      }
      if (tarea.corriendo) {
        return responder(res, 409, { success: false, message: 'Ya hay una actualizacion en curso' });
      }
      tarea.ahora();
      return responder(res, 202, {
        success: true,
        message: 'Actualizacion iniciada; tarda unos 11 minutos. Consulte /ping para ver el avance.',
      });
    }

    // Recarga la base tras una actualizacion, sin reiniciar el servicio.
    if (ruta === '/recargar') {
      if (TOKEN && tokenRecibido(req, url) !== TOKEN) {
        return responder(res, 401, { success: false, message: 'Token invalido' });
      }
      padron.recargar();
      log('padron recargado');
      return responder(res, 200, { success: true, padron: padron.estado() });
    }

    // Compatibilidad con clientes que llamaban a una API PHP:
    //   GET /read.php?ruc=20512963545
    // Devuelve el JSON anidado bajo `data` con nombres en camelCase.
    // El formato propio (/ruc/, /dni/) no cambia.
    if (/^\/read(\.php)?$/i.test(ruta)) {
      if (TOKEN && tokenRecibido(req, url) !== TOKEN) {
        return responder(res, 401, { success: false, message: 'Token invalido' });
      }

      const doc = String(url.searchParams.get('ruc') || url.searchParams.get('dni') || '').trim();
      if (!/^\d{8}$|^\d{11}$/.test(doc)) {
        // El cliente antiguo trata cualquier cosa que no sea un JSON valido
        // como "no encontrado", y espera el texto 'false'.
        return responderTexto(res, 200, 'false');
      }

      const tipoDoc = doc.length === 11 ? 'ruc' : 'dni';
      const datos = await consultar(tipoDoc, doc);
      if (!datos) return responderTexto(res, 200, 'false');

      res.setHeader('X-Tiempo-Ms', String(Date.now() - inicio));
      return responder(res, 200, tipoDoc === 'ruc'
        ? compat.respuestaRuc(datos, doc)
        : compat.respuestaDni(datos, doc));
    }

    const m = /^\/(ruc|dni)\/(\d+)$/i.exec(ruta);
    if (!m) {
      return responder(res, 400, { success: false, message: 'Ruta no valida. Use /ruc/{ruc} o /dni/{dni}' });
    }

    const tipo = m[1].toLowerCase();
    const numero = m[2];

    if (TOKEN && tokenRecibido(req, url) !== TOKEN) {
      return responder(res, 401, { success: false, message: 'Token invalido' });
    }

    if (tipo === 'ruc' && numero.length !== 11) {
      return responder(res, 400, { success: false, message: 'El RUC debe tener 11 digitos' });
    }
    if (tipo === 'dni' && numero.length !== 8) {
      return responder(res, 400, { success: false, message: 'El DNI debe tener 8 digitos' });
    }

    const clave = `${tipo}:${numero}`;
    let promesa = enVuelo.get(clave);
    let compartida = true;

    if (!promesa) {
      compartida = false;
      promesa = consultar(tipo, numero).finally(() => enVuelo.delete(clave));
      enVuelo.set(clave, promesa);
    }

    const datos = await promesa;

    if (!datos) {
      return responder(res, 404, {
        success: false,
        message: `No se encontro informacion para el ${tipo.toUpperCase()} ${numero}`,
      });
    }

    res.setHeader('X-Tiempo-Ms', String(Date.now() - inicio));
    if (compartida) res.setHeader('X-Compartida', '1');

    return responder(res, 200, datos);
  } catch (err) {
    log('ERROR', ruta, err && err.message);
    if (err && err.code === 'PADRON_AUSENTE') {
      return responder(res, 503, {
        success: false,
        message: 'El padron no esta cargado. Ejecute: npm run actualizar-padron',
      });
    }
    return responder(res, 502, { success: false, message: 'Error al consultar el padron' });
  }
});

async function consultar(tipo, numero) {
  if (tipo === 'ruc') {
    const e = padron.consultarRuc(numero);
    return e && e.razonSocial ? formatoRuc(e, numero, SOLO_ASCII) : null;
  }
  const p = padron.consultarDni(numero);
  return p ? formatoDni(p, numero, SOLO_ASCII) : null;
}

function tokenRecibido(req, url) {
  const auth = req.headers.authorization || '';
  const m = /Bearer\s+(.+)/i.exec(auth);
  if (m) return m[1].trim();
  return url.searchParams.get('token') || req.headers['x-api-token'] || '';
}

function responder(res, status, cuerpo) {
  const json = JSON.stringify(cuerpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

// El cliente antiguo espera el texto literal 'false' cuando no hay datos,
// no un JSON de error.
function responderTexto(res, status, texto) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(texto),
  });
  res.end(texto);
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

servidor.keepAliveTimeout = 65000;
servidor.headersTimeout = 70000;

let tarea = null;

servidor.listen(PUERTO, () => {
  log(`Servicio de consulta escuchando en http://0.0.0.0:${PUERTO}`);
  log(`Token: ${TOKEN ? 'activo' : 'desactivado'} | Solo ASCII: ${SOLO_ASCII}`);
  if (cfg.origenEnv) log(`Configuracion: ${cfg.origenEnv}`);
  const e = padron.estado();
  if (e.cargado) {
    log(`Padron: ${e.filas.toLocaleString('es-PE')} filas | ${e.tamano_mb} MB | actualizado ${e.actualizado_en}`);
  } else {
    log('AVISO: el padron no esta cargado. Ejecute: npm run actualizar-padron');
  }

  // La actualizacion corre en un proceso aparte: mientras dura, este
  // servidor sigue respondiendo con la base vigente.
  tarea = programar(HORA_PADRON, () => {
    // Cierra la base, pone la nueva en su sitio y la reabre.
    padron.intercambiar();
    padron.recargar();
    const n = padron.estado();
    log(`base recargada: ${n.filas.toLocaleString('es-PE')} filas | actualizado ${n.actualizado_en}`);
  }, log);

  if (!tarea) log('Actualizacion automatica: desactivada');
});

const apagar = () => {
  if (tarea) tarea.cancelar();
  servidor.close(() => process.exit(0));
};
process.on('SIGINT', apagar);
process.on('SIGTERM', apagar);
