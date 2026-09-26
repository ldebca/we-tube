// services/mediaScanner.js
// Escanea el directorio configurable de medios (config.mediaRoot) y devuelve
// los archivos organizados por usuario/tipo. Tambien permite registrar en la
// base de datos archivos "huerfanos" (copiados a mano al servidor) para que
// aparezcan en el catalogo web con metadata minima.
'use strict';

const fs = require('fs');
const path = require('path');
const cfg = require('../config');
const { pool } = require('../db');

function classify(ext) {
  const e = ext.toLowerCase();
  const p = cfg.properties.media;
  if (p.allowedVideoExt.includes(e)) return 'video';
  if (p.allowedAudioExt.includes(e)) return 'audio';
  if (p.allowedImageExt.includes(e)) return 'image';
  return null;
}

/** Recorre media/<userDir> y devuelve archivos multimedia validos con su tipo */
function scanUserDir(userDirName) {
  const dir = path.join(cfg.mediaRoot, userDirName);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => !f.endsWith('.info.json') && !f.endsWith('.jpg.part'))
    .map((f) => ({ file: f, type: classify(path.extname(f)), fullPath: path.join(dir, f) }))
    .filter((x) => x.type !== null);
}

/**
 * Sincroniza la DB con lo que hay realmente en disco para un usuario:
 * inserta registros faltantes con metadata minima (nombre de archivo como
 * titulo) y elimina de la DB los registros cuyo archivo ya no existe.
 */
async function syncUserMedia(identity, userDirName) {
  const { ownerIdForDb, isIncognito, incognitoSessionId } = identity;
  const onDisk = scanUserDir(userDirName);
  const whereClause = isIncognito ? 'incognito_session_id = $1' : 'owner_id = $1';
  const whereParam = isIncognito ? incognitoSessionId : ownerIdForDb;
  const { rows: existing } = await pool.query(
    `SELECT id, relative_path, pending_download FROM media WHERE ${whereClause}`,
    [whereParam]
  );
  const existingPaths = new Set(existing.filter((r) => !r.pending_download).map((r) => r.relative_path));

  for (const item of onDisk) {
    const relPath = path.join(userDirName, item.file);
    if (!existingPaths.has(relPath)) {
      const stat = fs.statSync(item.fullPath);
      await pool.query(
        `INSERT INTO media (owner_id, file_name, relative_path, media_type, title, is_incognito, incognito_session_id, file_size_bytes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [ownerIdForDb, item.file, relPath, item.type, path.parse(item.file).name, isIncognito, incognitoSessionId, stat.size]
      );
    }
  }

  // Elimina registros huerfanos (archivo borrado manualmente del disco)
  const onDiskPaths = new Set(onDisk.map((i) => path.join(userDirName, i.file)));
  for (const row of existing.filter((r) => !r.pending_download)) {
    if (!onDiskPaths.has(row.relative_path)) {
      await pool.query('DELETE FROM media WHERE id = $1', [row.id]);
    }
  }
}

module.exports = { classify, scanUserDir, syncUserMedia };
