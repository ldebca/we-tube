// services/jobs.js
// Cola simple de trabajos en memoria para ejecutar descargas de yt-dlp en
// segundo plano (requisito 11: el usuario puede seguir navegando/reproduciendo
// mientras una descarga o subida corre). Cada job se persiste en la tabla
// download_jobs para que el progreso se pueda consultar via polling desde el
// frontend (GET /api/downloads/:id) incluso si el usuario cambia de pagina.
'use strict';

const path = require('path');
const fs = require('fs');
const { pool } = require('../db');
const ytdlp = require('./ytdlp');
const cfg = require('../config');

const MAX_CONCURRENT = 2;
let running = 0;
const queue = [];

async function updateJob(id, fields) {
  const sets = [];
  const values = [];
  let i = 1;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`);
    values.push(v);
  }
  sets.push(`updated_at = now()`);
  values.push(id);
  await pool.query(`UPDATE download_jobs SET ${sets.join(', ')} WHERE id = $${i}`, values);
}

function userMediaDir(userDirName) {
  const dir = path.join(cfg.mediaRoot, userDirName);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function processNext() {
  if (running >= MAX_CONCURRENT || queue.length === 0) return;
  const job = queue.shift();
  running += 1;
  try {
    await updateJob(job.id, { status: 'running' });
    const outDir = userMediaDir(job.userDirName);

    await ytdlp.runDownload(
      job.options,
      outDir,
      (percent) => {
        updateJob(job.id, { progress: percent }).catch(() => {});
      },
      (logLine) => {
        // Log acotado: solo se guardan los ultimos ~4000 caracteres para no crecer sin limite
        job.logBuf = ((job.logBuf || '') + logLine).slice(-4000);
      }
    );

    // Tras completar, leer metadata del .info.json mas reciente y registrar en `media`
    const info = ytdlp.findLatestInfoJson(outDir);
    if (info) {
      const ext = job.options.mode === 'audio' ? (job.options.audioFormat || 'mp3') : 'mp4';
      const fileGuess = fs
        .readdirSync(outDir)
        .filter((f) => f.endsWith('.' + ext) && f.includes(`[${info.id}]`))
        .sort((a, b) => fs.statSync(path.join(outDir, b)).mtimeMs - fs.statSync(path.join(outDir, a)).mtimeMs)[0];

      if (fileGuess) {
        const stat = fs.statSync(path.join(outDir, fileGuess));

        // Busca el archivo de miniatura que yt-dlp genero junto al video (--write-thumbnail)
        const thumbFile = fs
          .readdirSync(outDir)
          .find((f) => f.includes(`[${info.id}]`) && /\.(jpg|jpeg|png|webp)$/i.test(f));
        const thumbnailRelPath = thumbFile ? path.join(job.userDirName, thumbFile) : null;
        const channelName = [job.options.channelName, info.uploader, info.channel]
          .find((value) => value && value !== 'NA') || null;

        const mediaValues = [
          fileGuess,
          path.join(job.userDirName, fileGuess),
          job.options.mode === 'audio' ? 'audio' : 'video',
          info.title || fileGuess,
          channelName,
          info.view_count || null,
          info.like_count || null,
          info.upload_date ? new Date(
            `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}`
          ) : null,
          info.duration ? Math.round(info.duration) : null,
          thumbnailRelPath,
          info.webpage_url || job.options.url,
          stat.size,
        ];
        if (job.options.pendingMediaId) {
          await pool.query(
            `UPDATE media SET file_name = $1, relative_path = $2, media_type = $3, title = $4,
              channel_name = $5, view_count = $6, like_count = $7, published_at = $8,
              duration_seconds = $9, thumbnail_path = $10, source_url = $11,
              file_size_bytes = $12, pending_download = FALSE
             WHERE id = $13 AND owner_id = $14 AND pending_download = TRUE`,
            [...mediaValues, job.options.pendingMediaId, job.ownerIdForDb]
          );
        } else {
          await pool.query(
            `INSERT INTO media
              (owner_id, file_name, relative_path, media_type, title, channel_name,
               view_count, like_count, published_at, duration_seconds, thumbnail_path,
               source_url, is_incognito, incognito_session_id, file_size_bytes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [job.ownerIdForDb, ...mediaValues.slice(0, 11), job.isIncognito, job.incognitoSessionId || null, mediaValues[11]]
          );
        }
      }
    }

    await updateJob(job.id, { status: 'done', progress: 100 });
  } catch (err) {
    console.error(`[jobs] Job ${job.id} fallo:`, err.message);
    await updateJob(job.id, { status: 'error', error: err.message }).catch(() => {});
  } finally {
    running -= 1;
    processNext();
  }
}

/**
 * Encola un nuevo trabajo de descarga.
 * ownerIdForDb: UUID real del usuario, o null si es incognito (no se persiste owner)
 * userDirName: carpeta destino dentro de media/ (ej: username o _incognito/<sessionId>)
 */
async function enqueueDownload({ ownerIdForDb, userDirName, url, options, isIncognito, incognitoSessionId }) {
  const { rows } = await pool.query(
    `INSERT INTO download_jobs (owner_id, url, status, options_json, is_incognito, incognito_session_id)
     VALUES ($1,$2,'queued',$3,$4,$5) RETURNING id`,
    [ownerIdForDb, url, JSON.stringify(options), !!isIncognito, incognitoSessionId || null]
  );
  const id = rows[0].id;
  queue.push({ id, ownerIdForDb, userDirName, options: { ...options, url }, isIncognito, incognitoSessionId });
  processNext();
  return id;
}

module.exports = { enqueueDownload, userMediaDir };
