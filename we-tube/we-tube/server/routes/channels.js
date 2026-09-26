// routes/channels.js
'use strict';

const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { resolveUserStorage } = require('../utils');
const channelsService = require('../services/channels');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const identity = resolveUserStorage(req.user);
  if (identity.isIncognito) return res.json([]); // canales no aplican en modo incognito
  const { rows } = await pool.query('SELECT * FROM channels WHERE owner_id = $1 ORDER BY created_at DESC', [
    identity.ownerIdForDb,
  ]);
  res.json(rows);
});

router.post('/', requireAuth, async (req, res) => {
  const identity = resolveUserStorage(req.user);
  if (identity.isIncognito) return res.status(400).json({ error: 'No disponible en modo incognito.' });
  const { channelUrl, channelName, initialDownloadCount } = req.body || {};
  if (!channelUrl) return res.status(400).json({ error: 'channelUrl es requerido.' });
  const downloadCount = Number.isInteger(Number(initialDownloadCount)) ? Number(initialDownloadCount) : 5;
  if (downloadCount < 0 || downloadCount > 25) {
    return res.status(400).json({ error: 'initialDownloadCount debe estar entre 0 y 25.' });
  }
  const { rows } = await pool.query(
    'INSERT INTO channels (owner_id, channel_url, channel_name) VALUES ($1,$2,$3) RETURNING *',
    [identity.ownerIdForDb, channelUrl, channelName || null]
  );
  try {
    const initialCheck = await channelsService.checkChannel(rows[0].id, downloadCount);
    console.log(`[channels] Carga inicial de ${channelUrl}: ${initialCheck.enqueued} videos encolados.`);
    res.status(201).json({ ...rows[0], initialCheck });
  } catch (err) {
    console.error(`[channels] Error en la carga inicial de ${channelUrl}:`, err.message);
    res.status(502).json({ error: `No se pudo revisar el canal: ${err.message}`, channel: rows[0] });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  const identity = resolveUserStorage(req.user);
  await pool.query('DELETE FROM channels WHERE id = $1 AND owner_id = $2', [req.params.id, identity.ownerIdForDb]);
  res.json({ ok: true });
});

router.post('/:id/more', requireAuth, async (req, res) => {
  const identity = resolveUserStorage(req.user);
  if (identity.isIncognito) return res.status(400).json({ error: 'No disponible en modo incognito.' });
  const { rows } = await pool.query('SELECT id FROM channels WHERE id = $1 AND owner_id = $2', [req.params.id, identity.ownerIdForDb]);
  if (!rows[0]) return res.status(404).json({ error: 'Canal no encontrado.' });
  try {
    const result = await channelsService.loadMoreChannel(req.params.id);
    res.json(result);
  } catch (err) {
    console.error(`[channels] Error cargando mas videos del canal ${req.params.id}:`, err.message);
    res.status(502).json({ error: err.message });
  }
});

// Fuerza una revision manual inmediata de todos los canales
router.post('/check-now', requireAuth, async (req, res) => {
  channelsService.checkAllChannels().catch((e) => console.error('[channels] check-now fallo:', e.message));
  res.json({ ok: true, message: 'Revision de canales iniciada en segundo plano.' });
});

module.exports = router;
