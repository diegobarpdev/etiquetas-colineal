module.exports = {
  apps: [
    {
      name: 'etiquetas-print-agent',
      script: 'index.js',
      cwd: __dirname,
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '5s',
      max_restarts: 20,
      kill_timeout: 5000,
      // Sin ventana de consola en Windows
      windowsHide: true,
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
