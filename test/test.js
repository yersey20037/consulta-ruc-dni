'use strict';
const { sanear, parseDireccion, formatoRuc, formatoDni } = require('../src/formato');

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? '  OK  ' : ' FALLA') + '  ' + msg); if (!cond) fallos++; };

console.log('\n=== SANEADO ===');
const casos = [
  ["TIENDAS & MAS S.A.C.", "TIENDAS Y MAS S.A.C."],
  ["ANONIMA 'O ' S.P.S.A.", "ANONIMA O S.P.S.A."],
  ['COMERCIAL "EL SOL" E.I.R.L.', "COMERCIAL EL SOL E.I.R.L."],
  ["SERVICIOS 1\u00aa CLASE <TEST>", "SERVICIOS 1A CLASE TEST"],
  ["AGRO\u00a0INDUSTRIAL \u2013 NORTE", "AGRO INDUSTRIAL - NORTE"],
  ["PE\u00d1A & COMPA\u00d1IA S.R.L.", "PE\u00d1A Y COMPA\u00d1IA S.R.L."],
  ["EMPRESA\tCON\nSALTOS", "EMPRESA CON SALTOS"],
];
for (const [inp, esp] of casos) {
  const got = sanear(inp);
  ok(got === esp, `"${inp}" -> "${got}"`);
}
ok(sanear("MU\u00d1OZ JOS\u00c9 MAR\u00cdA", true) === "MUNOZ JOSE MARIA", 'SOLO_ASCII quita tildes y N');

console.log('\n=== PARSER DE DIRECCION ===');
const d1 = parseDireccion("AV. JORGE CHAVEZ NRO. 204 URB. JORGE CHAVEZ");
ok(d1.tipo_de_via === 'AV.' && d1.nombre_de_via === 'JORGE CHAVEZ' && d1.numero === '204'
   && d1.codigo_de_zona === 'URB.' && d1.tipo_de_zona === 'JORGE CHAVEZ', 'AV. + NRO. + URB.');
const d2 = parseDireccion("CAL.MORELLI NRO. 181 INT. P-2");
ok(d2.tipo_de_via === 'CAL.' && d2.nombre_de_via === 'MORELLI' && d2.interior === 'P-2', 'abreviatura pegada');
const d3 = parseDireccion("JR. LIBERTAD MZA. B LOTE. 12 A.H. VILLA MARIA");
ok(d3.manzana === 'B' && d3.lote === '12' && d3.codigo_de_zona === 'A.H.', 'MZA + LOTE + A.H.');
const d4 = parseDireccion("CAR. PANAMERICANA NORTE KM. 25");
ok(d4.kilometro === '25', 'kilometro');

console.log('\n=== ARMADO DE DIRECCION DESDE EL PADRON ===');
// El padron trae la direccion en columnas sueltas; padron.js la rearma en
// una sola cadena para que parseDireccion() la separe con sus reglas.
const { _internos: _pad } = require('../src/padron');
const fila = {
  ruc: '20131312955',
  nombre: 'SUPERINTENDENCIA NACIONAL DE ADUANAS Y DE ADMINISTRACION TRIBUTARIA - SUNAT',
  estado: 'ACTIVO', condicion: 'HABIDO', ubigeo: '150101',
  tipo_via: 'AV.', nombre_via: 'GARCILASO DE LA VEGA', cod_zona: '-', tipo_zona: '-',
  numero: '1472', interior: '-', lote: '-', departamento: 'LIMA', manzana: '-', kilometro: '-',
};
const emp = _pad.aEmpresa(fila);
ok(emp.razonSocial.startsWith('SUPERINTENDENCIA'), `razon social: "${emp.razonSocial}"`);
ok(emp.estado === 'ACTIVO' && emp.condicion === 'HABIDO', 'estado y condicion');
ok(emp.ubigeo === '150101', 'el padron trae ubigeo');
ok(emp.direccion === 'AV. GARCILASO DE LA VEGA NRO. 1472', `direccion rearmada: "${emp.direccion}"`);

// Los '-' que el padron usa como "vacio" no deben ensuciar la direccion.
const emp2 = _pad.aEmpresa({ ...fila, numero: '-', interior: '-', manzana: 'B', lote: '12' });
ok(emp2.direccion === 'AV. GARCILASO DE LA VEGA MZA. B LOTE. 12', `omite los '-': "${emp2.direccion}"`);

console.log('\n=== DNI DERIVADO DEL RUC 10 ===');
ok(_pad.dniDeRuc('10452159428') === '45215942', 'RUC 10 -> DNI embebido');
ok(_pad.dniDeRuc('20131312955') === null, 'RUC 20 (empresa) no tiene DNI');

console.log('\n=== UBIGEO ===');
const { ubicacion, UBIGEOS } = require('../src/ubigeo');
ok(Object.keys(UBIGEOS).length > 1800, `${Object.keys(UBIGEOS).length} distritos en el catalogo`);

const sb = ubicacion('150130');
ok(sb.distrito === 'SAN BORJA' && sb.provincia === 'LIMA' && sb.departamento === 'LIMA',
   `150130 -> ${sb.distrito}, ${sb.provincia}, ${sb.departamento}`);
const cl = ubicacion('070101');
ok(cl.departamento === 'PROV. CONST. DEL CALLAO', 'Callao se normaliza');
const md = ubicacion('170101');
ok(md.departamento === 'MADRE DE DIOS', 'departamento de varias palabras');

// Un ubigeo que no esta en el catalogo resuelve al menos el departamento.
const nc = ubicacion('130112');
ok(nc.departamento === 'LA LIBERTAD' && nc.provincia === '' && nc.distrito === '',
   'ubigeo sin entrada cae al departamento');
// Basura no revienta.
for (const malo of ['999999', '-', '', 'HABIDO', null]) {
  const r = ubicacion(malo);
  ok(r.departamento !== undefined, `ubigeo invalido no revienta: ${JSON.stringify(malo)}`);
}

console.log('\n=== PARSER DE LINEAS DEL PADRON ===');
const { campos } = require('../src/padron')._internos;

const normal = campos('20512963545|ZONA INFORMATICA S.R.L.|BAJA DE OFICIO|HABIDO|150130|AV.|SAN LUIS|-|-|2076|-|-|403|-|-|');
ok(normal[1] === 'ZONA INFORMATICA S.R.L.' && normal[4] === '150130' && normal[12] === '403',
   'linea normal: 15 campos alineados');

// Algunas razones sociales llevan '|' dentro y corren todas las columnas.
const conPipe = campos('20614244730|EBEN EZER | INGENIERIA S.A.C.|ACTIVO|HABIDO|150114|CAL.|LA PAZ|URB.|SANTA PATRICIA|200|-|-|-|-|');
ok(conPipe[1] === 'EBEN EZER | INGENIERIA S.A.C.', `nombre con pipe reconstruido: "${conPipe[1]}"`);
ok(conPipe[2] === 'ACTIVO' && conPipe[3] === 'HABIDO' && conPipe[4] === '150114',
   'columnas realineadas tras el pipe');

ok(campos('20512963545|SOLO|TRES') === null, 'linea corta se descarta');
ok(campos('ABC|X|Y|Z|150130|AV.|N|-|-|1|-|-|-|-|-|') === null, 'RUC invalido se descarta');

console.log('\n=== PROGRAMADOR ===');
const { programar, msHasta } = require('../src/programador');

// La proxima ejecucion siempre cae en el futuro, dentro de 24h y a la hora pedida.
for (const [h, mi] of [[3, 0], [0, 0], [23, 59], [12, 30]]) {
  const ms = msHasta(h, mi);
  const d = new Date(Date.now() + ms);
  ok(ms > 0 && ms <= 86400000 && d.getHours() === h && d.getMinutes() === mi,
     `proxima ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')} en ${(ms / 3600000).toFixed(1)}h`);
}

// Horas invalidas no programan nada (y no revientan el arranque).
for (const mala of ['25:00', '3', 'abc', '03:70', '']) {
  ok(programar(mala, () => {}, () => {}) === null, `hora invalida rechazada: "${mala}"`);
}

// Una hora valida si programa; se cancela para no dejar el intervalo vivo.
const tarea = programar('03:00', () => {}, () => {});
ok(tarea !== null, 'hora valida programada');
if (tarea) tarea.cancelar();

console.log('\n=== FORMATO FINAL ===');
const salida = formatoRuc(emp, '20131312955');
const esperados = ['success','ruc','nombre_o_razon_social','estado_del_contribuyente','condicion_de_domicilio',
  'ubigeo','tipo_de_via','nombre_de_via','codigo_de_zona','tipo_de_zona','numero','interior','lote','dpto',
  'manzana','kilometro','distrito','provincia','departamento','direccion_simple','direccion','actualizado_en'];
ok(JSON.stringify(Object.keys(salida)) === JSON.stringify(esperados), 'las 22 claves en el orden exacto');
ok(salida.success === true, 'success es booleano true');
console.log(JSON.stringify(salida, null, 2));

const dniOut = formatoDni({ apellidoPaterno:'CASTILLO', apellidoMaterno:'GOMES', nombres:'VANESSA SILVIA' }, '43451826');
ok(dniOut.nombre === 'CASTILLO GOMES VANESSA SILVIA', 'nombre DNI concatenado');
console.log(JSON.stringify(dniOut));

console.log(fallos === 0 ? '\nTODAS LAS PRUEBAS PASARON\n' : `\n${fallos} PRUEBAS FALLARON\n`);
process.exit(fallos === 0 ? 0 : 1);
