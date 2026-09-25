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
  const { channelUrl, channelName } = req.body || {};
  if (!channelUrl) return res.status(400).json({ error: 'channelUrl es requerido.' });
  const { rows } = await pool.query(
    'INSERT INTO channels (owner_id, channel_url, channel_name) VALUES ($1,$2,$3) RETURNING *',
    [identity.ownerIdForDb, channelUrl, channelName || null]
  );
  res.status(201).json(rows[0]);
});

router.delete('/:id', requireAuth, async (req, res) => {
  const identity = resolveUserStorage(req.user);
  await pool.query('DELETE FROM channels WHERE id = $1 AND owner_id = $2', [req.params.id, identity.ownerIdForDb]);
  res.json({ ok: true });
});

// Fuerza una revision manual inmediata de todos los canales
router.post('/check-now', requireAuth, async (req, res) => {
  channelsService.checkAllChannels().catch((e) => console.error('[channels] check-now fallo:', e.message));
  res.json({ ok: true, message: 'Revision de canales iniciada en segundo plano.' });
});

module.exports = router;
