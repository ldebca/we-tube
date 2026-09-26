// routes/config.js
// Permite ver y editar config/properties.json desde la web (requisito 3: la
// ruta del directorio local y otros parametros deben ser configurables).
'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const cfg = require('../config');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  // Se oculta el secreto JWT en la respuesta
  const { auth, ...rest } = cfg.properties;
  res.json({ ...rest, auth: { allowRegistration: auth.allowRegistration } });
});

router.put('/', requireAuth, (req, res) => {
  const incoming = req.body || {};
  const merged = {
    ...cfg.properties,
    ...incoming,
    auth: { ...cfg.properties.auth, allowRegistration: Boolean(incoming.auth?.allowRegistration) },
  };
  cfg.saveProperties(merged);
  cfg.reload();
  res.json({ ok: true, properties: cfg.properties });
});

module.exports = router;
