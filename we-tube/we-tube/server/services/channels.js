// services/channels.js
// Requisito 18: permitir registrar canales de YouTube y revisarlos
// periodicamente por videos nuevos, encolando su descarga automaticamente.
'use strict';

const { pool } = require('../db');
const ytdlp = require('./ytdlp');
const jobs = require('./jobs');

async function checkAllChannels() {
  const { rows: channels } = await pool.query(
    `SELECT c.*, u.username AS owner_username
     FROM channels c JOIN users u ON u.id = c.owner_id`
  );
  for (const ch of channels) {
    try {
      const videos = await ytdlp.listChannelVideos(ch.channel_url);
      // Solo consideramos "nuevo" lo publicado despues del ultimo check
      // (heuristica simple: yt-dlp --flat-playlist no trae fecha exacta sin
      // costo extra, asi que limitamos a los N mas recientes del listado)
      const recent = videos.slice(0, 5);

      const { rows: known } = await pool.query(
        `SELECT source_url FROM media WHERE owner_id = $1`,
        [ch.owner_id]
      );
      const knownUrls = new Set(known.map((r) => r.source_url));

      for (const v of recent) {
        if (!knownUrls.has(v.url)) {
          await jobs.enqueueDownload({
            ownerIdForDb: ch.owner_id,
            userDirName: ch.owner_username,
            url: v.url,
            options: { mode: 'video', quality: 'best', isPlaylist: false },
            isIncognito: false,
          });
        }
      }

      await pool.query('UPDATE channels SET last_checked_at = now() WHERE id = $1', [ch.id]);
    } catch (err) {
      console.error(`[channels] Error revisando canal ${ch.channel_url}:`, err.message);
    }
  }
}

module.exports = { checkAllChannels };
