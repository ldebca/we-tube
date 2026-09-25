// config.js
// Carga config/properties.json (editable por el usuario) y la combina con
// variables de entorno (.env). properties.json controla el comportamiento
// funcional de la app (rutas, limpieza, yt-dlp); .env controla secretos/infra.
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const PROPERTIES_PATH = path.join(__dirname, '..', 'config', 'properties.json');

function loadProperties() {
  const raw = fs.readFileSync(PROPERTIES_PATH, 'utf-8');
  return JSON.parse(raw);
}

function saveProperties(props) {
  fs.writeFileSync(PROPERTIES_PATH, JSON.stringify(props, null, 2), 'utf-8');
}

const properties = loadProperties();

// Resuelve rutas relativas del directorio de medios respecto a la raiz del proyecto
const mediaRoot = path.isAbsolute(properties.media.rootDir)
  ? properties.media.rootDir
  : path.join(__dirname, '..', properties.media.rootDir);

if (!fs.existsSync(mediaRoot)) {
  fs.mkdirSync(mediaRoot, { recursive: true });
}

module.exports = {
  properties,
  ytdlpPath: process.env.YTDLP_PATH || properties.ytdlp.binaryPath || 'yt-dlp',
  reload() {
    const fresh = loadProperties();
    Object.keys(fresh).forEach((k) => {
      module.exports.properties[k] = fresh[k];
    });
    return module.exports.properties;
  },
  saveProperties,
  mediaRoot,
  db: {
    host: process.env.PGHOST || '172.18.0.2',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'wetube',
  },
  port: Number(process.env.PORT || properties.server.port || 4000),
  jwtSecret: process.env.JWT_SECRET || properties.auth.jwtSecret,
};
