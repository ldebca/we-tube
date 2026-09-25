// routes/auth.js
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const { signSession, requireAuth } = require('../middleware/auth');
const cleanup = require('../services/cleanup');
const cfg = require('../config');

const router = express.Router();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  // secure: true, // habilitar cuando se sirva sobre HTTPS
};

router.post('/register', async (req, res) => {
  if (!cfg.properties.auth.allowRegistration) {
    return res.status(403).json({ error: 'El registro de nuevos usuarios esta deshabilitado.' });
  }
  const { username, email, password } = req.body || {};
  if (!username || !email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Usuario, email y password (min. 6 caracteres) son requeridos.' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (username, email, password_hash) VALUES ($1,$2,$3) RETURNING id, username`,
      [username.trim().toLowerCase(), email.trim().toLowerCase(), hash]
    );
    const user = rows[0];
    const token = signSession({ sub: user.id, username: user.username, incognito: false });
    res.cookie('wt_token', token, COOKIE_OPTS);
    res.json({ id: user.id, username: user.username });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'El usuario o email ya existe.' });
    }
    console.error('[auth] Error en registro:', err.message);
    res.status(500).json({ error: 'Error interno al registrar el usuario.' });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Usuario y password requeridos.' });
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE username = $1 OR email = $1',
    [username.trim().toLowerCase()]
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Credenciales invalidas.' });
  }
  const token = signSession({ sub: user.id, username: user.username, incognito: false, isAdmin: user.is_admin });
  res.cookie('wt_token', token, COOKIE_OPTS);
  res.json({ id: user.id, username: user.username });
});

// Requisito 12: modo incognito. No requiere cuenta; crea una sesion "fantasma".
router.post('/incognito', async (req, res) => {
  const sessionId = uuidv4();
  const token = signSession({
    sub: `incog-${sessionId}`,
    username: 'Incognito',
    incognito: true,
    incognitoSessionId: sessionId,
  });
  res.cookie('wt_token', token, COOKIE_OPTS);
  res.json({ id: `incog-${sessionId}`, username: 'Incognito', incognito: true });
});

router.post('/logout', requireAuth, (req, res) => {
  if (req.user.incognito) {
    cleanup.purgeIncognitoDir(req.user.incognitoSessionId);
  }
  res.clearCookie('wt_token');
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    id: req.user.sub,
    username: req.user.username,
    incognito: !!req.user.incognito,
    isAdmin: !!req.user.isAdmin,
  });
});

module.exports = router;
