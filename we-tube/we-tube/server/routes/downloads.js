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
    subtitles, subLangs, embedThumbnail, rateLimit, proxy, cookiesFile, extraArgs } = req.body || {};

  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Debes proporcionar una URL valida (http/https).' });
  }

  const identity = resolveUserStorage(req.user);
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
  };

  const jobId = await jobs.enqueueDownload({
    ownerIdForDb: identity.ownerIdForDb,
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
