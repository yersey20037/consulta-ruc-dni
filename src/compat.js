'use strict';

/**
 * Formato de respuesta compatible con clientes que esperaban una API PHP
 * del estilo `read.php?ruc=...`.
 *
 * Se diferencia del formato propio en tres cosas:
 *   - los datos van anidados bajo `data`;
 *   - los nombres de campo son camelCase (tipoVia, nombreVia, ...);
 *   - incluye campos que el Padron Reducido no trae y aqui se deducen.
 *
 * Hay clientes que leen `tipoPersona` + `numeroDocumento` y otros que leen
 * `ruc` + `dni` por separado. Se devuelven TODOS: cada cliente toma los que
 * conoce e ignora el resto, asi uno solo sirve a todos sin recompilarlos.
 *
 * El formato propio (/ruc/, /dni/) no cambia.
 */

/**
 * JURIDICA o NATURAL segun el tipo de RUC.
 *
 * Los RUC que empiezan en '10' (y los antiguos '15' y '17') son personas
 * naturales; el resto ('20' empresas, '16' no domiciliadas) son juridicas.
 */
function tipoPersona(ruc) {
  const p = String(ruc || '').slice(0, 2);
  return (p === '10' || p === '15' || p === '17') ? 'NATURAL' : 'JURIDICA';
}

/**
 * Arma la respuesta compatible a partir de la salida de formatoRuc().
 * `documento` es lo que consulto el cliente (RUC de 11 o DNI de 8).
 */
function respuestaRuc(r, documento) {
  const nro = r.ruc || documento;
  const natural = tipoPersona(nro) === 'NATURAL';

  return {
    data: {
      // Para clientes que leen `ruc` y `dni` por separado y deciden segun
      // cual venga lleno. En un RUC de persona natural (10) el DNI son los
      // digitos 3 al 10.
      ruc: nro,
      dni: natural && nro.length === 11 ? nro.slice(2, 10) : '',
      // Para clientes que leen `tipoPersona` y `numeroDocumento`.
      tipoPersona: tipoPersona(nro),
      numeroDocumento: nro,
      nombre: r.nombre_o_razon_social || '',
      estado: r.estado_del_contribuyente || '',
      condicionDomicilio: r.condicion_de_domicilio || '',
      tipoVia: limpia(r.tipo_de_via),
      nombreVia: limpia(r.nombre_de_via),
      numero: limpia(r.numero),
      codigoZona: limpia(r.codigo_de_zona),
      tipoZona: limpia(r.tipo_de_zona),
      ubigeo: r.ubigeo || '',
      // Extras que el cliente antiguo ignora, pero no estorban.
      distrito: r.distrito || '',
      provincia: r.provincia || '',
      departamento: r.departamento || '',
      direccion: r.direccion_simple || '',
    },
  };
}

/**
 * Respuesta compatible para una consulta por DNI. El padron solo tiene el
 * nombre, asi que los campos de direccion van vacios.
 */
function respuestaDni(r, dni) {
  return {
    data: {
      // Consulta por DNI: `ruc` va vacio para que los clientes que miran
      // ese campo caigan por la rama del DNI.
      ruc: '',
      dni,
      tipoPersona: 'NATURAL',
      numeroDocumento: dni,
      nombre: r.nombre || '',
      estado: '',
      condicionDomicilio: '',
      tipoVia: '',
      nombreVia: '',
      numero: '',
      codigoZona: '',
      tipoZona: '',
      ubigeo: '',
    },
  };
}

/**
 * El cliente antiguo muestra los campos tal cual: un '-' (que en el padron
 * significa "sin dato") quedaria pegado en la direccion. Se vacia.
 */
function limpia(v) {
  const s = String(v == null ? '' : v).trim();
  return s === '-' ? '' : s;
}

module.exports = { respuestaRuc, respuestaDni, tipoPersona, _internos: { limpia } };
