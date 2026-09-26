// routes/media.js
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const mime = require('./mimeHelper');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { resolveUserStorage } = require('../utils');
const scanner = require('../services/mediaScanner');
const cfg = require('../config');

const router = express.Router();

// Lista el catalogo del usuario autenticado (video/audio/imagen), con busqueda opcional (?q=)
router.get('/', requireAuth, async (req, res) => {
  const identity = resolveUserStorage(req.user);
  await scanner.syncUserMedia(identity, identity.dirName).catch((e) =>
    console.error('[media] Error sincronizando disco -> DB:', e.message)
  );

  const { q, type } = req.query;
  const whereClause = identity.isIncognito ? 'incognito_session_id = $1' : 'owner_id = $1';
  const params = [identity.isIncognito ? identity.incognitoSessionId : identity.ownerIdForDb];
  let sql = `SELECT * FROM media WHERE ${whereClause}`;

  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    sql += ` AND (LOWER(title) LIKE $${params.length} OR LOWER(channel_name) LIKE $${params.length})`;
  }
  if (type) {
    params.push(type);
    sql += ` AND media_type = $${params.length}`;
  }
  sql += ' ORDER BY created_at DESC';

  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

router.get('/:id', requireAuth, async (req, res) => {
  const identity = resolveUserStorage(req.user);
  const { rows } = await pool.query('SELECT * FROM media WHERE id = $1', [req.params.id]);
  const item = rows[0];
  if (!item || !ownsMedia(item, identity)) return res.status(404).json({ error: 'No encontrado.' });
  res.json(item);
});

function ownsMedia(item, identity) {
  if (identity.isIncognito) return item.incognito_session_id === identity.incognitoSessionId;
  return item.owner_id === identity.ownerIdForDb;
}

// Streaming con soporte de HTTP Range para reproduccion fluida en alta calidad
router.get('/:id/stream', requireAuth, async (req, res) => {
  const identity = resolveUserStorage(req.user);
  const { rows } = await pool.query('SELECT * FROM media WHERE id = $1', [req.params.id]);
  const item = rows[0];
  if (!item || !ownsMedia(item, identity)) return res.status(404).end();
  if (item.pending_download) return res.status(409).json({ error: 'Este video esta pendiente de descarga.' });

  const filePath = path.join(cfg.mediaRoot, item.relative_path);
  if (!fs.existsSync(filePath)) return res.status(404).end();

  const stat = fs.statSync(filePath);
  const range = req.headers.range;
  const contentType = mime.lookup(filePath);

  if (!range) {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': contentType });
    return fs.createReadStream(filePath).pipe(res);
  }

  const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
  const start = parseInt(startStr, 10);
  const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
  const chunkSize = end - start + 1;

  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunkSize,
    'Content-Type': contentType,
  });
  fs.createReadStream(filePath, { start, end }).pipe(res);
});

router.delete('/:id', requireAuth, async (req, res) => {
  const identity = resolveUserStorage(req.user);
  const { rows } = await pool.query('SELECT * FROM media WHERE id = $1', [req.params.id]);
  const item = rows[0];
  if (!item || !ownsMedia(item, identity)) return res.status(404).json({ error: 'No encontrado.' });

  const filePath = item.relative_path ? path.join(cfg.mediaRoot, item.relative_path) : null;
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    if (filePath) {
      const infoJson = filePath.replace(path.extname(filePath), '.info.json');
      if (fs.existsSync(infoJson)) fs.unlinkSync(infoJson);
    }
    if (item.thumbnail_path) {
      const thumbnailPath = path.join(cfg.mediaRoot, item.thumbnail_path);
      if (fs.existsSync(thumbnailPath)) fs.unlinkSync(thumbnailPath);
    }
  } catch (err) {
    console.error('[media] Error borrando archivo del disco:', err.message);
  }
  await pool.query('DELETE FROM media WHERE id = $1', [item.id]);
  res.json({ ok: true });
});

router.post('/:id/favorite', requireAuth, async (req, res) => {
  const identity = resolveUserStorage(req.user);
  const { rows } = await pool.query('SELECT * FROM media WHERE id = $1', [req.params.id]);
  const item = rows[0];
  if (!item || !ownsMedia(item, identity)) return res.status(404).json({ error: 'No encontrado.' });
  const { rows: updated } = await pool.query(
    'UPDATE media SET favorite = NOT favorite WHERE id = $1 RETURNING favorite',
    [item.id]
  );
  res.json({ favorite: updated[0].favorite });
});

module.exports = router;
