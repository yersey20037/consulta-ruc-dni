// Configuracion de PM2
//   pm2 start ecosystem.config.js
//   pm2 save
module.exports = {
  apps: [
    {
      name: 'consulta-ruc-dni',
      script: 'server.js',
      cwd: __dirname,

      instances: 1,          // Node es asincrono: 1 proceso atiende muchas
      exec_mode: 'fork',     // consultas simultaneas sin bloquearse
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',

      // La configuracion vive en .env (ver .env.ejemplo).
      // Lo que se ponga aqui TIENE PRIORIDAD sobre el .env: usalo solo si
      // necesitas forzar un valor para esta instancia en concreto.
      env: {
        NODE_ENV: 'production',
      },

      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
