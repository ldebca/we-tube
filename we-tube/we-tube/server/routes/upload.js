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
const { normalizeUploadMetadata } = require('../services/uploadMetadata');
const { generateAutoThumbnail } = require('../services/autoThumbnail');
const { classify } = require('../services/mediaScanner');
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
    const allowed = file.fieldname === 'thumbnail'
      ? p.allowedImageExt
      : [...p.allowedVideoExt, ...p.allowedAudioExt, ...p.allowedImageExt];
    if (!allowed.includes(ext)) {
      return cb(new Error(`Extension no permitida: ${ext}`));
    }
    cb(null, true);
  },
});

router.post('/', requireAuth, upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]), async (req, res) => {
  const uploadedFile = req.files?.file?.[0] || req.file;
  if (!uploadedFile) return res.status(400).json({ error: 'No se recibio ningun archivo.' });

  const identity = resolveUserStorage(req.user);

  try {
    await scanner.syncUserMedia(identity, identity.dirName);

    const relativePath = path.relative(cfg.mediaRoot, uploadedFile.path).replace(/\\/g, '/');
    const thumbnailRelativePath = req.files?.thumbnail?.[0]
      ? path.relative(cfg.mediaRoot, req.files.thumbnail[0].path).replace(/\\/g, '/')
      : null;

    let finalThumbnailRelativePath = thumbnailRelativePath;
    if (!finalThumbnailRelativePath) {
      const mediaType = classify(path.extname(uploadedFile.originalname));
      if (mediaType && mediaType !== 'image') {
        const generated = generateAutoThumbnail({
          sourcePath: uploadedFile.path,
          outputDir: path.dirname(uploadedFile.path),
          mediaType,
          originalName: uploadedFile.originalname,
          customTitle: req.body.title,
        });
        if (generated.thumbnailPath) {
          finalThumbnailRelativePath = path.relative(cfg.mediaRoot, generated.thumbnailPath).replace(/\\/g, '/');
        }
      }
    }

    const metadata = normalizeUploadMetadata({
      title: req.body.title,
      channel: req.body.channel,
      author: req.body.author,
      description: req.body.description,
      sourceUrl: req.body.sourceUrl,
      thumbnailPath: finalThumbnailRelativePath,
    }, uploadedFile.originalname);

    const updateQuery = identity.isIncognito
      ? 'UPDATE media SET title = $1, channel_name = $2, author_name = $3, description = $4, source_url = $5, thumbnail_path = $6 WHERE incognito_session_id = $7 AND relative_path = $8'
      : 'UPDATE media SET title = $1, channel_name = $2, author_name = $3, description = $4, source_url = $5, thumbnail_path = $6 WHERE owner_id = $7 AND relative_path = $8';

    await pool.query(updateQuery, [
      metadata.title,
      metadata.channel_name,
      metadata.author_name,
      metadata.description,
      metadata.source_url,
      metadata.thumbnail_path,
      identity.isIncognito ? identity.incognitoSessionId : identity.ownerIdForDb,
      relativePath,
    ]);

    res.status(201).json({ ok: true, fileName: uploadedFile.filename, metadata });
  } catch (err) {
    console.error('[upload] Error registrando archivo subido:', err.message);
    res.status(500).json({ error: 'Archivo subido pero no se pudo registrar en el catalogo.' });
  }
});

module.exports = router;
