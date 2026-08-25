'use strict';

/**
 * Actualizacion automatica del padron a una hora fija.
 *
 * La carga tarda ~11 minutos y usa SQLite sincrono: el CREATE INDEX solo
 * bloquea el hilo unos 14 segundos, pero es suficiente para que el servicio
 * deje de responder. Por eso la actualizacion NO corre dentro del proceso
 * del servidor: se lanza `actualizar-padron.js` como proceso hijo aparte.
 *
 * Mientras el hijo trabaja, el servidor sigue atendiendo con la base
 * vigente. Al terminar, el hijo deja la base nueva como `padron.db.nuevo`
 * y es el SERVIDOR quien la pone en su sitio: en Windows no se puede
 * renombrar un archivo que otro proceso mantiene abierto, y el que lo
 * tiene abierto es este.
 */

const path = require('path');
const { spawn } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'actualizar-padron.js');

/** Devuelve los ms que faltan hasta la proxima ocurrencia de hh:mm. */
function msHasta(hora, minuto) {
  const ahora = new Date();
  const objetivo = new Date(ahora);
  objetivo.setHours(hora, minuto, 0, 0);
  if (objetivo <= ahora) objetivo.setDate(objetivo.getDate() + 1);
  return objetivo.getTime() - ahora.getTime();
}

/**
 * Programa la actualizacion diaria.
 *
 *   hora     '03:00' (24h). Vacio o invalido = no se programa nada.
 *   alTerminar  callback que se llama tras una actualizacion exitosa,
 *               para que el servidor recargue la base.
 *   log      funcion de log.
 *
 * Devuelve { cancelar() } o null si no quedo programada.
 */
function programar(hora, alTerminar, log = console.log) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hora || '').trim());
  if (!m) return null;

  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) {
    log(`AVISO: hora de actualizacion invalida: "${hora}"`);
    return null;
  }

  let temporizador = null;
  let corriendo = false;

  const ejecutar = () => {
    if (corriendo) {
      log('actualizacion: ya hay una en curso, se omite esta');
      return;
    }
    corriendo = true;

    const t0 = Date.now();
    log('actualizacion automatica: iniciando');

    // Proceso aparte: la carga bloquea el hilo y aqui no puede hacerlo.
    const hijo = spawn(process.execPath, [SCRIPT], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // El hijo deja la base en `padron.db.nuevo` y NO la intercambia:
      // el archivo vigente lo tiene abierto este proceso y Windows no
      // deja renombrarlo desde fuera.
      env: { ...process.env, LO_LANZA_EL_SERVIDOR: '1' },
    });

    const relevante = (t) => /Listo:|FALLO:|MB en|filas insertadas|indice/.test(t);
    for (const flujo of [hijo.stdout, hijo.stderr]) {
      let resto = '';
      flujo.on('data', (c) => {
        const lineas = (resto + c.toString()).split('\n');
        resto = lineas.pop();
        for (const l of lineas) {
          const t = l.trim();
          if (t && relevante(t)) log('  ' + t);
        }
      });
    }

    hijo.on('error', (e) => {
      corriendo = false;
      log(`actualizacion: no se pudo lanzar el proceso: ${e.message}`);
    });

    hijo.on('close', (code) => {
      corriendo = false;
      const min = ((Date.now() - t0) / 60000).toFixed(1);
      if (code === 0) {
        log(`actualizacion terminada en ${min} min`);
        try {
          alTerminar();   // el servidor intercambia y reabre la base
        } catch (e) {
          log(`AVISO: no se pudo poner la base nueva en su sitio: ${e.message}`);
          log('  el servicio sigue con la base anterior; se reintentara mañana');
        }
      } else {
        // actualizar-padron.js conserva la base anterior si algo falla.
        log(`actualizacion FALLIDA (codigo ${code}) tras ${min} min; ` +
            'se sigue usando la base anterior');
      }
    });
  };

  // Un solo setTimeout de hasta 24h no sobrevive bien a una suspension de
  // la PC: Windows congela el temporizador y la hora se puede pasar de
  // largo. En vez de eso se revisa el reloj cada minuto y se dispara cuando
  // toca, comparando contra la fecha de la ultima ejecucion.
  const PASO_MS = 60000;
  let ultimoDia = null;   // 'YYYY-MM-DD' de la ultima ejecucion

  const clave = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

  const revisar = () => {
    const ahora = new Date();
    const yaToca = ahora.getHours() > hh ||
                   (ahora.getHours() === hh && ahora.getMinutes() >= mm);
    if (yaToca && ultimoDia !== clave(ahora)) {
      ultimoDia = clave(ahora);
      ejecutar();
    }
  };

  const agendar = () => {
    if (temporizador) clearInterval(temporizador);
    temporizador = setInterval(revisar, PASO_MS);
    // No mantiene vivo el proceso por si mismo.
    if (temporizador.unref) temporizador.unref();

    const ms = msHasta(hh, mm);
    const h = Math.floor(ms / 3600000);
    const m2 = Math.round((ms % 3600000) / 60000);
    log(`Actualizacion automatica: todos los dias a las ${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')} ` +
        `(la proxima en ${h}h ${m2}m)`);
  };

  // Si al arrancar la hora de hoy ya paso, se marca el dia como hecho: el
  // servicio no debe lanzar una carga de 11 minutos nada mas encenderse.
  const inicio = new Date();
  if (inicio.getHours() > hh || (inicio.getHours() === hh && inicio.getMinutes() >= mm)) {
    ultimoDia = clave(inicio);
  }

  agendar();

  return {
    cancelar() {
      if (temporizador) clearInterval(temporizador);
      temporizador = null;
    },
    /**
     * Lanza la actualizacion ahora, sin esperar a la hora programada.
     * No cuenta como la del dia: si la lanzas a mano a las 10:00, la
     * automatica de las 03:00 se hara igual mañana.
     */
    ahora: ejecutar,
    get corriendo() { return corriendo; },
  };
}

module.exports = { programar, msHasta };
