// routes/upload.js
// Requisito 7 y 8: permite subir archivos de video/audio/imagen desde la web,
// almacenandolos en el mismo directorio local usado para el catalogo (punto 3).
'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { resolveUserStorage } = require('../utils');
const scanner = require('../services/mediaScanner');
const cfg = require('../config');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const identity = resolveUserStorage(req.user);
    const dir = path.join(cfg.mediaRoot, identity.dirName);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Se prefija timestamp para evitar colisiones sin perder el nombre original
    const safe = file.originalname.replace(/[^\w.\- ]+/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: cfg.properties.media.maxUploadSizeMB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const p = cfg.properties.media;
    const allowed = [...p.allowedVideoExt, ...p.allowedAudioExt, ...p.allowedImageExt];
    if (!allowed.includes(ext)) {
      return cb(new Error(`Extension no permitida: ${ext}`));
    }
    cb(null, true);
  },
});

router.post('/', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibio ningun archivo.' });
  const identity = resolveUserStorage(req.user);

  try {
    // La sincronizacion con el escaner de disco registra el archivo subido en la DB
    await scanner.syncUserMedia(identity, identity.dirName);
    res.status(201).json({ ok: true, fileName: req.file.filename });
  } catch (err) {
    console.error('[upload] Error registrando archivo subido:', err.message);
    res.status(500).json({ error: 'Archivo subido pero no se pudo registrar en el catalogo.' });
  }
});

module.exports = router;
