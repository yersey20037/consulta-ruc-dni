'use strict';

/**
 * Formato de salida + saneado de caracteres.
 *
 * Quita lo que suele romper a los consumidores: caracteres fuera de
 * Windows-1252 (sistemas legados), comillas (SQL) y los caracteres que
 * hay que escapar en XML (& < > ").
 */

const TIPOGRAFICOS = {
  '\u00a0': ' ', // espacio duro
  '\u201c': ' ', // comilla doble izquierda
  '\u201d': ' ', // comilla doble derecha
  '\u201e': ' ', // comilla doble baja
  '\u2018': ' ', // comilla simple izquierda
  '\u2019': ' ', // apostrofo tipografico
  '\u201a': ' ', // comilla simple baja
  '\u00ab': ' ', // <<
  '\u00bb': ' ', // >>
  '\u00b4': ' ', // acento agudo suelto
  '\u2013': '-', // guion medio
  '\u2014': '-', // guion largo
  '\u2011': '-', // guion sin salto
  '\u2212': '-', // signo menos
  '\u2026': '.', // puntos suspensivos
  '\u2022': ' ', // vineta
  '\u00b7': ' ', // punto medio
  '\u00aa': 'A', // ordinal femenino
  '\u00ba': 'O', // ordinal masculino
  '"': ' ',
  "'": ' ',
  '`': ' ',
};

const SIN_TILDE = {
  Á: 'A', À: 'A', Ä: 'A', Â: 'A', á: 'a', à: 'a', ä: 'a', â: 'a',
  É: 'E', È: 'E', Ë: 'E', Ê: 'E', é: 'e', è: 'e', ë: 'e', ê: 'e',
  Í: 'I', Ì: 'I', Ï: 'I', Î: 'I', í: 'i', ì: 'i', ï: 'i', î: 'i',
  Ó: 'O', Ò: 'O', Ö: 'O', Ô: 'O', ó: 'o', ò: 'o', ö: 'o', ô: 'o',
  Ú: 'U', Ù: 'U', Ü: 'U', Û: 'U', ú: 'u', ù: 'u', ü: 'u', û: 'u',
  Ñ: 'N', ñ: 'n', Ç: 'C', ç: 'c',
};

const RE_TIPOGRAFICOS = new RegExp(
  '[' + Object.keys(TIPOGRAFICOS).map((c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('') + ']',
  'g'
);
const RE_SIN_TILDE = /[ÁÀÄÂáàäâÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔóòöôÚÙÜÛúùüûÑñÇç]/g;

const OK_CON_TILDE = /[^A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñÀÈÌÒÙÂÊÎÔÛÄËÏÖÇç .,\-/#()°]/g;
const OK_SOLO_ASCII = /[^A-Za-z0-9 .,\-/#()°]/g;

function sanear(s, soloAscii = false) {
  if (!s) return '';
  let t = String(s);

  t = t.replace(RE_TIPOGRAFICOS, (c) => TIPOGRAFICOS[c]);
  t = t.split('&').join(' Y ');           // el & hay que escaparlo en XML
  t = t.replace(/[\u0000-\u001f\u007f]/g, ' ');

  if (soloAscii) t = t.replace(RE_SIN_TILDE, (c) => SIN_TILDE[c] || c);

  t = t.replace(soloAscii ? OK_SOLO_ASCII : OK_CON_TILDE, ' ');

  return t.replace(/\s+/g, ' ').trim();
}

/* ================================================================
 *  PARSER DE DIRECCION SUNAT
 * ================================================================ */

const VIAS = new Set([
  'AV.', 'AV', 'AVE.', 'JR.', 'JR', 'CAL.', 'CA.', 'CALLE', 'PSJ.', 'PJ.',
  'PASAJE', 'CAR.', 'CARR.', 'CARRETERA', 'AL.', 'ALM.', 'MAL.', 'OVA.',
  'BLV.', 'BV.', 'PRL.', 'PRLG.', 'PQ.', 'PZA.', 'PSA.', 'OTR.', 'SDA.', 'ESQ.',
]);

const ZONAS = new Set([
  'URB.', 'AA.HH.', 'A.H.', 'AH.', 'P.J.', 'PJ.', 'C.P.', 'CP.', 'C.P.M.',
  'COO.', 'COOP.', 'CON.', 'CONJ.', 'RES.', 'ASC.', 'ASOC.', 'FND.', 'CAS.',
  'UNI.', 'ZNA.', 'SEC.', 'GRU.', 'BAR.', 'ANX.', 'COM.', 'CHA.', 'H.U.',
  'HU.', 'PDO.', 'PRE.', 'ETP.',
]);

const NUMS = {
  'NRO.': 'numero', NRO: 'numero', 'NO.': 'numero', '#': 'numero',
  'INT.': 'interior', INT: 'interior',
  'LOTE.': 'lote', LOTE: 'lote', 'LT.': 'lote', 'LOT.': 'lote',
  'DPTO.': 'dpto', DPTO: 'dpto', 'DEP.': 'dpto', 'DPT.': 'dpto', 'DEPT.': 'dpto',
  'MZA.': 'manzana', MZA: 'manzana', 'MZ.': 'manzana', MZ: 'manzana',
  'KM.': 'kilometro', KM: 'kilometro',
};

function parseDireccion(dir) {
  const r = {
    tipo_de_via: '-', nombre_de_via: '-',
    codigo_de_zona: '-', tipo_de_zona: '-',
    numero: '-', interior: '-', lote: '-',
    dpto: '-', manzana: '-', kilometro: '-',
  };

  let d = String(dir || '').toUpperCase().trim();
  if (!d || d === '-') return r;

  // SUNAT a veces pega la abreviatura al nombre: "CAL.MORELLI" -> "CAL. MORELLI"
  d = d.replace(/\b([A-Z]{2,4})\.(?=[A-Z0-9])/g, '$1. ').replace(/\s+/g, ' ').trim();

  const tk = d.split(' ');
  let i = 0;

  if (VIAS.has(tk[0])) {
    r.tipo_de_via = tk[0];
    i = 1;
  }

  let destino = 'nombre_de_via';
  let buf = [];

  const volcar = () => {
    if (!buf.length) return;
    const val = buf.join(' ').trim();
    if (val) r[destino] = r[destino] === '-' ? val : r[destino] + ' ' + val;
    buf = [];
  };

  for (; i < tk.length; i++) {
    const t = tk[i];
    if (NUMS[t]) {
      volcar();
      destino = NUMS[t];
      continue;
    }
    if (ZONAS.has(t)) {
      volcar();
      r.codigo_de_zona = t;
      destino = 'tipo_de_zona';
      continue;
    }
    buf.push(t);
  }
  volcar();

  if (['SN', 'S/N', 'S.N.'].includes(r.numero)) r.numero = '-';

  return r;
}

/* ================================================================
 *  FORMATO FINAL
 * ================================================================ */

function ahora() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function formatoRuc(e, ruc, soloAscii = false) {
  const direccion = sanear(e.direccion, soloAscii);
  const dep = sanear(e.departamento, soloAscii);
  const pro = sanear(e.provincia, soloAscii);
  const dis = sanear(e.distrito, soloAscii);

  const p = parseDireccion(direccion);

  const dirSimple = direccion || '-';
  const ubic = [dep, pro, dis].filter(Boolean).join(' ');
  const dirFull = ubic ? `${dirSimple} - ${ubic}` : dirSimple;

  return {
    success: true,
    ruc,
    nombre_o_razon_social: sanear(e.razonSocial, soloAscii),
    estado_del_contribuyente: sanear(e.estado, soloAscii),
    condicion_de_domicilio: sanear(e.condicion, soloAscii),
    ubigeo: sanear(e.ubigeo, soloAscii),
    tipo_de_via: p.tipo_de_via,
    nombre_de_via: p.nombre_de_via,
    codigo_de_zona: p.codigo_de_zona,
    tipo_de_zona: p.tipo_de_zona,
    numero: p.numero,
    interior: p.interior,
    lote: p.lote,
    dpto: p.dpto,
    manzana: p.manzana,
    kilometro: p.kilometro,
    distrito: dis,
    provincia: pro,
    departamento: dep,
    direccion_simple: dirSimple,
    direccion: dirFull,
    actualizado_en: ahora(),
  };
}

function formatoDni(p, dni, soloAscii = false) {
  const nombre = sanear(
    `${p.apellidoPaterno || ''} ${p.apellidoMaterno || ''} ${p.nombres || ''}`,
    soloAscii
  );
  if (!nombre) return null;
  return { success: true, dni, nombre };
}

module.exports = { sanear, parseDireccion, formatoRuc, formatoDni };
