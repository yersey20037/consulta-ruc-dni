'use strict';

/**
 * Descarga el Padron Reducido de SUNAT y lo carga a SQLite.
 *
 *   node actualizar-padron.js            descarga y carga
 *   node actualizar-padron.js archivo.zip  carga un ZIP ya descargado
 *
 * Tarda unos minutos. La base vigente sigue atendiendo consultas durante
 * todo el proceso; el reemplazo al final es atomico.
 *
 * Cuando lo lanza el servidor (variable LO_LANZA_EL_SERVIDOR=1), este
 * script NO hace el intercambio: deja la base nueva en `padron.db.nuevo`
 * y sale. El intercambio lo hace el servidor, que es quien tiene el
 * archivo abierto — en Windows no se puede renombrar una base que otro
 * proceso mantiene abierta (EBUSY).
 */

const fs = require('fs');
const cfg = require('./src/config');   // lee .env antes que nada
const padron = require('./src/padron');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const t0 = Date.now();
  if (cfg.origenEnv) log(`Configuracion: ${cfg.origenEnv}`);
  const zipLocal = process.argv[2];

  try {
    if (zipLocal) {
      if (!fs.existsSync(zipLocal)) {
        console.error(`No existe el archivo: ${zipLocal}`);
        process.exit(1);
      }
      log(`Cargando ZIP local: ${zipLocal}`);
      const r = await padron.cargar(zipLocal, log);
      log(`Listo: ${r.filas.toLocaleString('es-PE')} filas`);
    } else {
      await padron.actualizar(log);
    }

    if (process.env.LO_LANZA_EL_SERVIDOR === '1') {
      // El servidor cierra su base y hace el intercambio.
      log('Base nueva lista; el servicio la pondra en su sitio');
      process.exit(0);
    }

    padron.intercambiar();
    const e = padron.estado();
    log(`Base: ${e.tamano_mb} MB | ${e.filas.toLocaleString('es-PE')} filas`);
    log(`Tiempo total: ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`);
    process.exit(0);
  } catch (err) {
    console.error('\nFALLO:', err.message);
    console.error('La base anterior (si existia) quedo intacta.');
    process.exit(1);
  }
})();
