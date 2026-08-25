'use strict';

/**
 * Configuracion del servicio, leida de `.env` (si existe) y del entorno.
 *
 * Node 22 lee el .env de forma nativa con process.loadEnvFile(): no hace
 * falta dotenv ni ninguna dependencia. Las variables que ya vengan del
 * entorno (por ejemplo las que inyecta PM2) tienen prioridad y NO se
 * pisan, para que `pm2 restart --update-env` siga sirviendo.
 */

const fs = require('fs');
const path = require('path');

const RUTA_ENV = process.env.ENV_FILE || path.join(__dirname, '..', '.env');

// Lo que ya estaba definido antes de cargar el .env manda.
const previas = new Set(Object.keys(process.env));

let origenEnv = null;

if (fs.existsSync(RUTA_ENV)) {
  const antes = { ...process.env };
  try {
    process.loadEnvFile(RUTA_ENV);
    // Restaurar las que ya existian: el .env no debe pisar al entorno real.
    for (const k of previas) process.env[k] = antes[k];
    origenEnv = RUTA_ENV;
  } catch (e) {
    console.error(`AVISO: no se pudo leer ${RUTA_ENV}: ${e.message}`);
  }
}

const texto = (nombre, porDefecto) =>
  process.env[nombre] !== undefined && process.env[nombre] !== ''
    ? process.env[nombre]
    : porDefecto;

const config = {
  PUERTO: Number(texto('PORT', '8080')),
  TOKEN: process.env.API_TOKEN || '',            // '' = sin token
  SOLO_ASCII: process.env.SOLO_ASCII === '1',
  // '' desactiva la actualizacion automatica; por eso se lee sin `texto()`.
  HORA_ACTUALIZACION: process.env.HORA_ACTUALIZACION ?? '03:00',
  origenEnv,
  RUTA_ENV,
};

module.exports = config;
