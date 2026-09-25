// services/cleanup.js
// Requisito 19: borra automaticamente archivos (y su registro en DB) que
// superen la antiguedad maxima configurada en config/properties.json
// (cleanup.maxAgeDays). Los archivos marcados como favoritos se conservan.
// Tambien limpia sesiones de incognito abandonadas (el navegador se cerro
// sin llamar a /api/auth/logout).
'use strict';

const fs = require('fs');
const path = require('path');
const cfg = require('../config');
const { pool } = require('../db');

async function runCleanup() {
  const { enabled, maxAgeDays } = cfg.properties.cleanup;
  if (!enabled) {
    console.log('[cleanup] Desactivado en la configuracion. Se omite.');
    return;
  }

  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
  const { rows } = await pool.query(
    `SELECT id, relative_path FROM media WHERE favorite = FALSE AND created_at < $1`,
    [cutoff]
  );

  let deleted = 0;
  for (const row of rows) {
    const fullPath = path.join(cfg.mediaRoot, row.relative_path);
    try {
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      await pool.query('DELETE FROM media WHERE id = $1', [row.id]);
      deleted += 1;
    } catch (err) {
      console.error(`[cleanup] No se pudo borrar ${fullPath}:`, err.message);
    }
  }
  console.log(`[cleanup] Ejecutado: ${deleted} archivo(s) eliminado(s) por antiguedad > ${maxAgeDays} dias.`);
}

/** Borra por completo una carpeta de sesion incognito (requisito 12) */
function purgeIncognitoDir(sessionId) {
  const dir = path.join(cfg.mediaRoot, '_incognito', sessionId);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`[cleanup] Sesion incognito ${sessionId} purgada del disco.`);
}

module.exports = { runCleanup, purgeIncognitoDir };
