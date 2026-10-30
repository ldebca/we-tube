// routes/media.js
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mime = require('./mimeHelper');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { resolveUserStorage } = require('../utils');
const scanner = require('../services/mediaScanner');
const cfg = require('../config');
const jobs = require('../services/jobs');

const router = express.Router();

// Lista el catalogo del usuario autenticado (video/audio/imagen), con busqueda opcional (?q=)
router.get('/', requireAuth, async (req, res) => {
  const identity = resolveUserStorage(req.user);
  await scanner.syncUserMedia(identity, identity.dirName).catch((e) =>
    console.error('[media] Error sincronizando disco -> DB:', e.message)
  );

  const { q, type } = req.query;
  const whereClause = identity.isIncognito ? 'm.incognito_session_id = $1' : 'm.owner_id = $1';
  const params = [identity.isIncognito ? identity.incognitoSessionId : identity.ownerIdForDb];
  let sql = `SELECT m.*,
    (SELECT c.channel_thumbnail FROM channels c
      WHERE c.owner_id = m.owner_id
        AND (c.id = m.channel_id OR (m.channel_id IS NULL AND c.channel_name = m.channel_name))
      ORDER BY (c.id = m.channel_id) DESC, c.created_at DESC
      LIMIT 1) AS channel_thumbnail
    FROM media m
    WHERE ${whereClause}
      AND (m.media_type <> 'video' OR NOT EXISTS (
        SELECT 1 FROM channels c
        WHERE c.owner_id = m.owner_id
          AND (c.id = m.channel_id OR (m.channel_id IS NULL AND c.channel_name = m.channel_name))
          AND NOT (m.video_kind = ANY(c.allowed_video_kinds))
      ))`;

  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    sql += ` AND (LOWER(m.title) LIKE $${params.length} OR LOWER(m.channel_name) LIKE $${params.length})`;
  }
  if (type) {
    params.push(type);
    sql += ` AND m.media_type = $${params.length}`;
  }
  sql += ` ORDER BY pending_download ASC,
    CASE WHEN pending_download THEN published_at END DESC NULLS LAST,
    CASE WHEN pending_download THEN pending_sort_at END DESC NULLS LAST,
    CASE WHEN pending_download THEN created_at END ASC,
    CASE WHEN NOT pending_download THEN created_at END DESC`;

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

const VIDEO_QUALITIES = new Set(['360', '480', '720', '1080', '1440', '2160']);

function inspectAudioTracks(filePath) {
  return new Promise((resolve, reject) => {
    const probe = spawn('ffprobe', [
      '-v', 'error', '-select_streams', 'a',
      '-show_entries', 'stream=index:stream_tags=language,title:stream_disposition=default',
      '-of', 'json', filePath,
    ]);
    let output = '';
    let errorOutput = '';
    probe.stdout.on('data', (chunk) => (output += chunk.toString()));
    probe.stderr.on('data', (chunk) => (errorOutput += chunk.toString()));
    probe.on('error', reject);
    probe.on('close', (code) => {
      if (code !== 0) return reject(new Error(errorOutput || 'ffprobe no pudo leer el archivo.'));
      try {
        const data = JSON.parse(output);
        resolve((data.streams || []).map((stream, index) => ({
          index,
          language: stream.tags?.language || null,
          title: stream.tags?.title || null,
          isDefault: Boolean(stream.disposition?.default),
        })));
      } catch (error) {
        reject(error);
      }
    });
  });
}

router.get('/:id/audio-tracks', requireAuth, async (req, res) => {
  const identity = resolveUserStorage(req.user);
  const { rows } = await pool.query('SELECT * FROM media WHERE id = $1', [req.params.id]);
  const item = rows[0];
  if (!item || !ownsMedia(item, identity)) return res.status(404).json({ error: 'No encontrado.' });
  if (item.media_type !== 'video' || item.pending_download || !item.relative_path) return res.json([]);
  const filePath = path.join(cfg.mediaRoot, item.relative_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado.' });
  try {
    res.json(await inspectAudioTracks(filePath));
  } catch (error) {
    res.json([]);
  }
});

router.post('/:id/quality', requireAuth, async (req, res) => {
  const identity = resolveUserStorage(req.user);
  const { rows } = await pool.query('SELECT * FROM media WHERE id = $1', [req.params.id]);
  const item = rows[0];
  if (!item || !ownsMedia(item, identity)) return res.status(404).json({ error: 'No encontrado.' });
  if (item.media_type !== 'video' || item.pending_download || !item.source_url) {
    return res.status(400).json({ error: 'Este medio no permite cambiar la resolucion.' });
  }
  const quality = String(req.body && req.body.quality || '');
  if (!VIDEO_QUALITIES.has(quality)) return res.status(400).json({ error: 'Resolucion no valida.' });
  let audioMultistreams = false;
  try {
    audioMultistreams = (await inspectAudioTracks(path.join(cfg.mediaRoot, item.relative_path))).length > 1;
  } catch (error) { /* si ffprobe no esta disponible se mantiene una pista */ }
  const jobId = await jobs.enqueueDownload({
    ownerIdForDb: identity.ownerIdForDb,
    channelId: item.channel_id,
    userDirName: identity.dirName,
    url: item.source_url,
    options: {
      mode: 'video', quality, isPlaylist: false, channelName: item.channel_name, audioMultistreams,
      replaceMediaId: item.id, videoKind: item.video_kind,
    },
    replaceMediaId: item.id,
    isIncognito: identity.isIncognito,
    incognitoSessionId: identity.incognitoSessionId,
  });
  res.status(202).json({ jobId, quality, status: 'queued' });
});

router.post('/:id/expire-after-view', requireAuth, async (req, res) => {
  const identity = resolveUserStorage(req.user);
  const { rows } = await pool.query('SELECT * FROM media WHERE id = $1', [req.params.id]);
  const item = rows[0];
  if (!item || !ownsMedia(item, identity)) return res.status(404).json({ error: 'No encontrado.' });
  if (item.media_type !== 'video' || item.pending_download) return res.status(400).json({ error: 'Este video no esta disponible para esta accion.' });

  const filePath = item.relative_path ? path.join(cfg.mediaRoot, item.relative_path) : null;
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    if (filePath) {
      const infoJson = filePath.replace(path.extname(filePath), '.info.json');
      if (fs.existsSync(infoJson)) fs.unlinkSync(infoJson);
    }
  } catch (error) {
    return res.status(500).json({ error: 'No se pudo eliminar el archivo visto.' });
  }

  const ownerCondition = identity.isIncognito ? 'incognito_session_id = $2' : 'owner_id = $2';
  await pool.query(
    `UPDATE media SET file_name = NULL, relative_path = NULL, file_size_bytes = NULL,
      pending_download = TRUE, pending_sort_at = now()
     WHERE id = $1 AND ${ownerCondition}`,
    [item.id, identity.isIncognito ? identity.incognitoSessionId : identity.ownerIdForDb]
  );
  res.json({ ok: true, pending: true });
});

// Streaming con soporte de HTTP Range para reproduccion fluida en alta calidad
router.get('/:id/stream', requireAuth, async (req, res) => {
  const identity = resolveUserStorage(req.user);
  const { rows } = await pool.query('SELECT * FROM media WHERE id = $1', [req.params.id]);
  const item = rows[0];
  if (!item || !ownsMedia(item, identity)) return res.status(404).end();
  if (item.pending_download) return res.status(409).json({ error: 'Este video esta pendiente de descarga.' });

  const filePath = path.join(cfg.mediaRoot, item.relative_path);
  if (!fs.existsSync(filePath)) return res.status(404).end();

  if (req.query.audioTrack !== undefined) {
    const audioTrack = Number(req.query.audioTrack);
    if (!Number.isInteger(audioTrack) || audioTrack < 0) return res.status(400).json({ error: 'Pista de audio invalida.' });
    try {
      const tracks = await inspectAudioTracks(filePath);
      if (!tracks[audioTrack]) return res.status(404).json({ error: 'Pista de audio no encontrada.' });
      const ffmpeg = spawn('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-i', filePath,
        '-map', '0:v:0', '-map', `0:a:${audioTrack}`,
        '-c:v', 'copy', '-c:a', 'aac', '-movflags', 'frag_keyframe+empty_moov',
        '-f', 'mp4', 'pipe:1',
      ]);
      ffmpeg.stderr.on('data', () => {});
      ffmpeg.on('error', () => { if (!res.headersSent) res.status(503).end(); });
      req.on('close', () => { if (!ffmpeg.killed) ffmpeg.kill('SIGTERM'); });
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' });
      return ffmpeg.stdout.pipe(res);
    } catch (error) {
      return res.status(503).json({ error: 'No se pudo cambiar la pista de audio.' });
    }
  }

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
