// routes/downloads.js
'use strict';

const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { resolveUserStorage } = require('../utils');
const jobs = require('../services/jobs');
const ytdlp = require('../services/ytdlp');

const router = express.Router();

// Verifica disponibilidad de yt-dlp (usado por la UI para avisar si falta instalar)
router.get('/version', requireAuth, async (req, res) => {
  const version = await ytdlp.getVersion();
  res.json({ available: !!version, version });
});

// Inicia una descarga en segundo plano. El usuario puede seguir navegando.
router.post('/', requireAuth, async (req, res) => {
  const { url, mode, quality, audioFormat, isPlaylist, playlistItems,
    subtitles, subLangs, embedThumbnail, rateLimit, proxy, cookiesFile, extraArgs, pendingMediaId } = req.body || {};

  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Debes proporcionar una URL valida (http/https).' });
  }

  const identity = resolveUserStorage(req.user);
  let channelId = null;
  if (pendingMediaId) {
    const { rows } = await pool.query(
      'SELECT id, channel_id FROM media WHERE id = $1 AND owner_id = $2 AND pending_download = TRUE',
      [pendingMediaId, identity.ownerIdForDb]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Video pendiente no encontrado.' });
    channelId = rows[0].channel_id;
  }
  const options = {
    mode: mode === 'audio' ? 'audio' : 'video',
    quality,
    audioFormat,
    isPlaylist: !!isPlaylist,
    playlistItems,
    subtitles: !!subtitles,
    subLangs,
    embedThumbnail: !!embedThumbnail,
    rateLimit,
    proxy,
    cookiesFile,
    extraArgs, // acceso completo a flags avanzados de yt-dlp (requisito 6)
    pendingMediaId: pendingMediaId || null,
  };

  const jobId = await jobs.enqueueDownload({
    ownerIdForDb: identity.ownerIdForDb,
    channelId,
    userDirName: identity.dirName,
    url,
    options,
    isIncognito: identity.isIncognito,
    incognitoSessionId: identity.incognitoSessionId,
  });

  res.status(202).json({ jobId, status: 'queued' });
});

// Consulta de progreso (polling desde el frontend, requisito 11: trabajo en 2do plano)
router.get('/:id', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM download_jobs WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Job no encontrado.' });
  res.json(rows[0]);
});

router.delete('/:id', requireAuth, async (req, res) => {
  const identity = resolveUserStorage(req.user);
  const whereClause = identity.isIncognito ? 'incognito_session_id = $2' : 'owner_id = $2';
  const { rows } = await pool.query(
    `DELETE FROM download_jobs
     WHERE id = $1 AND ${whereClause} AND status IN ('done', 'error')
     RETURNING id`,
    [req.params.id, identity.isIncognito ? identity.incognitoSessionId : identity.ownerIdForDb]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Solo se pueden quitar descargas completadas o con error.' });
  res.json({ ok: true });
});

// Lista todos los jobs del usuario (para un panel de "descargas activas/recientes")
router.get('/', requireAuth, async (req, res) => {
  const identity = resolveUserStorage(req.user);
  const whereClause = identity.isIncognito ? 'incognito_session_id = $1' : 'owner_id = $1';
  const param = identity.isIncognito ? identity.incognitoSessionId : identity.ownerIdForDb;
  const { rows } = await pool.query(
    `SELECT * FROM download_jobs WHERE ${whereClause} ORDER BY created_at DESC LIMIT 50`,
    [param]
  );
  res.json(rows);
});

module.exports = router;
