// db.js
// Pool de conexion a PostgreSQL + creacion idempotente del esquema.
// Se usa "CREATE TABLE IF NOT EXISTS" para que el arranque del servidor
// (ver index.js) pueda llamar a ensureSchema() cada vez sin romper nada.
'use strict';

const { Pool } = require('pg');
const cfg = require('./config');

const pool = new Pool({ ...cfg.db, connectionTimeoutMillis: 8000 });

pool.on('error', (err) => {
  // Log de monitoreo: errores inesperados del pool (conexiones caidas, etc.)
  console.error('[db] Error inesperado en el pool de PostgreSQL:', err.message);
});

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(64) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  file_name TEXT,
  relative_path TEXT,
  media_type VARCHAR(16) NOT NULL, -- video | audio | image
  video_kind VARCHAR(16) NOT NULL DEFAULT 'normal', -- normal | short | live
  title TEXT,
  channel_name TEXT,
  view_count BIGINT,
  like_count BIGINT,
  published_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  thumbnail_path TEXT,
  source_url TEXT,
  pending_download BOOLEAN NOT NULL DEFAULT FALSE,
  favorite BOOLEAN NOT NULL DEFAULT FALSE,
  is_incognito BOOLEAN NOT NULL DEFAULT FALSE,
  incognito_session_id TEXT,
  file_size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_media_owner ON media(owner_id);
CREATE INDEX IF NOT EXISTS idx_media_type ON media(media_type);
CREATE INDEX IF NOT EXISTS idx_media_incognito ON media(incognito_session_id);
ALTER TABLE media ALTER COLUMN file_name DROP NOT NULL;
ALTER TABLE media ALTER COLUMN relative_path DROP NOT NULL;
ALTER TABLE media ADD COLUMN IF NOT EXISTS pending_download BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE media ADD COLUMN IF NOT EXISTS video_kind VARCHAR(16) NOT NULL DEFAULT 'normal';
CREATE INDEX IF NOT EXISTS idx_media_video_kind ON media(video_kind);

CREATE TABLE IF NOT EXISTS download_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'queued', -- queued|running|done|error
  progress NUMERIC(5,2) NOT NULL DEFAULT 0,
  options_json JSONB,
  log TEXT,
  error TEXT,
  is_incognito BOOLEAN NOT NULL DEFAULT FALSE,
  incognito_session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_owner ON download_jobs(owner_id);

CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  channel_url TEXT NOT NULL,
  channel_name TEXT,
  video_cursor INTEGER NOT NULL DEFAULT 1,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_channels_owner ON channels(owner_id);
ALTER TABLE channels ADD COLUMN IF NOT EXISTS video_cursor INTEGER NOT NULL DEFAULT 1;
ALTER TABLE media ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES channels(id) ON DELETE SET NULL;
ALTER TABLE download_jobs ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES channels(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_media_channel ON media(channel_id);
CREATE INDEX IF NOT EXISTS idx_jobs_channel ON download_jobs(channel_id);
`;

const MIGRATION_SQL = [
  "ALTER TABLE media ADD COLUMN IF NOT EXISTS video_kind VARCHAR(16) NOT NULL DEFAULT 'normal';",
  'CREATE INDEX IF NOT EXISTS idx_media_video_kind ON media(video_kind);',
  "ALTER TABLE media ALTER COLUMN video_kind SET DEFAULT 'normal';",
];

async function ensureSchema() {
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  } catch (e) {
    console.warn('[db] No se pudo crear extension pgcrypto (puede requerir permisos de superusuario):', e.message);
  }

  try {
    await pool.query(SCHEMA_SQL);
  } catch (err) {
    console.error('[db] Error al aplicar el esquema inicial:', err.message);
    throw err;
  }

  for (const sql of MIGRATION_SQL) {
    try {
      await pool.query(sql);
    } catch (err) {
      console.warn('[db] Migracion SQL no aplicada:', err.message);
    }
  }

  try {
    await pool.query(`
      UPDATE media
      SET video_kind = CASE
        WHEN media_type = 'video' AND (source_url ~* '/shorts/' OR source_url ~* 'shorts/') THEN 'short'
        WHEN media_type = 'video' AND (
          source_url ~* '/live' OR source_url ~* 'live/' OR source_url ~* 'youtu\.be/.+/live' OR source_url ~* 'youtube\.com/live/'
        ) THEN 'live'
        ELSE video_kind
      END
      WHERE media_type = 'video';
    `);
  } catch (err) {
    console.warn('[db] No se pudo corregir video_kind existente:', err.message);
  }

  console.log('[db] Esquema verificado/creado correctamente.');
}

module.exports = { pool, ensureSchema };

// Permite ejecutar `npm run init-db` para inicializar el esquema manualmente
if (require.main === module && process.argv.includes('--init')) {
  ensureSchema()
    .then(() => {
      console.log('[db] Inicializacion completa.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[db] Fallo la inicializacion del esquema:', err);
      process.exit(1);
    });
}
