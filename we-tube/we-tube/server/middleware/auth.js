// middleware/auth.js
// Autentica peticiones via cookie httpOnly "wt_token" (JWT).
// Soporta dos tipos de sesion:
//   - normal:    { sub: userId, username, incognito: false }
//   - incognito: { sub: 'incog-<uuid>', username: 'Incognito', incognito: true }
// El modo incognito NO requiere cuenta: se crea una sesion "fantasma" cuyo
// contenido se guarda en una carpeta temporal y se borra al cerrar sesion
// (ver routes/auth.js -> POST /api/auth/logout) o por el cron de limpieza.
'use strict';

const jwt = require('jsonwebtoken');
const cfg = require('../config');

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.wt_token;
  if (!token) {
    return res.status(401).json({ error: 'No autenticado. Inicia sesion para continuar.' });
  }
  try {
    const payload = jwt.verify(token, cfg.jwtSecret);
    req.user = payload; // { sub, username, incognito, isAdmin }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesion invalida o expirada.' });
  }
}

// Version "suave": si hay token valido lo adjunta, si no, continua como anonimo.
function optionalAuth(req, res, next) {
  const token = req.cookies && req.cookies.wt_token;
  if (!token) return next();
  try {
    req.user = jwt.verify(token, cfg.jwtSecret);
  } catch (err) {
    // token invalido: se ignora, sigue como anonimo
  }
  next();
}

function signSession(payload) {
  return jwt.sign(payload, cfg.jwtSecret, { expiresIn: cfg.properties.auth.jwtExpiresIn });
}

module.exports = { requireAuth, optionalAuth, signSession };
