// index.js
// Punto de entrada de we-tube. Responsabilidades:
//  1. Inicializar el esquema de PostgreSQL (idempotente).
//  2. Montar las rutas de la API REST.
//  3. Servir el frontend estatico (public/) y los archivos multimedia.
//  4. Programar tareas en segundo plano: limpieza automatica y revision de canales.
// Para que arranque junto con el sistema operativo, ver we-tube.service (systemd)
// documentado en README.md.
'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');

const cfg = require('./config');
const { ensureSchema } = require('./db');
const cleanupService = require('./services/cleanup');
const channelsService = require('./services/channels');
const ytdlp = require('./services/ytdlp');

const authRoutes = require('./routes/auth');
const mediaRoutes = require('./routes/media');
const downloadRoutes = require('./routes/downloads');
const uploadRoutes = require('./routes/upload');
const channelRoutes = require('./routes/channels');
const configRoutes = require('./routes/config');

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// --- Log simple de monitoreo por peticion ---
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/downloads', downloadRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/config', configRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', mediaRoot: cfg.mediaRoot }));

// Sirve miniaturas/imagenes directamente (los videos/audio usan /api/media/:id/stream,
// que soporta Range requests). Requiere sesion valida para respetar el aislamiento
// entre usuarios, ya que el path por si solo no valida propiedad del archivo.
const { optionalAuth } = require('./middleware/auth');
const { resolveUserStorage } = require('./utils');
app.use('/media-files', optionalAuth, (req, res, next) => {
  if (!req.user) return res.status(401).end();
  // Aisla el acceso: un usuario solo puede leer imagenes/miniaturas de su propia carpeta
  const identity = resolveUserStorage(req.user);
  const requested = decodeURIComponent(req.path.replace(/^\//, ''));
  if (!requested.startsWith(identity.dirName.replace(/\\/g, '/'))) {
    return res.status(403).end();
  }
  next();
}, express.static(cfg.mediaRoot));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor.' });
});

async function start() {
  try {
    await ensureSchema();
  } catch (err) {
    console.error('[startup] No se pudo inicializar PostgreSQL. Verifica la conexion (.env):', err.message);
    process.exit(1);
  }

  const ytdlpVersion = await ytdlp.getVersion();
  if (!ytdlpVersion) {
    console.warn(
      '[startup] ADVERTENCIA: no se detecto yt-dlp en el PATH del servidor. ' +
        'Las descargas fallaran hasta instalarlo: https://github.com/yt-dlp/yt-dlp'
    );
  } else {
    console.log(`[startup] yt-dlp detectado, version ${ytdlpVersion}`);
  }

  // Tarea programada: limpieza de archivos viejos (requisito 19)
  cron.schedule(cfg.properties.cleanup.cronSchedule, () => {
    cleanupService.runCleanup().catch((e) => console.error('[cron] cleanup fallo:', e.message));
  });

  // Tarea programada: revision de canales suscritos (requisito 18)
  cron.schedule(cfg.properties.channels.checkIntervalCron, () => {
    channelsService.checkAllChannels().catch((e) => console.error('[cron] channels check fallo:', e.message));
  });

  app.listen(cfg.port, () => {
    console.log(`[startup] we-tube escuchando en http://localhost:${cfg.port}`);
    console.log(`[startup] Directorio de medios: ${cfg.mediaRoot}`);
  });
}

start();

module.exports = app; // exportado para pruebas (supertest)
