// services/channels.js
// Requisito 18: permitir registrar canales de YouTube y revisarlos
// periodicamente por videos nuevos, encolando su descarga automaticamente.
'use strict';

const fs = require('fs');
const path = require('path');
const { pool } = require('../db');
const cfg = require('../config');
const ytdlp = require('./ytdlp');
const jobs = require('./jobs');

async function checkAllChannels() {
  const { rows: channels } = await pool.query(
    `SELECT c.*, u.username AS owner_username
     FROM channels c JOIN users u ON u.id = c.owner_id`
  );
  for (const ch of channels) {
    try {
      await checkChannelRow(ch, Infinity, false, 5, 1);
    } catch (err) {
      console.error(`[channels] Error revisando canal ${ch.channel_url}:`, err.message);
    }
  }
}

async function checkChannel(channelId, initialDownloadCount = 5) {
  const { rows } = await pool.query(
    `SELECT c.*, u.username AS owner_username
     FROM channels c JOIN users u ON u.id = c.owner_id
     WHERE c.id = $1`,
    [channelId]
  );
  if (rows[0]) return checkChannelRow(rows[0], initialDownloadCount, true, 25, 1);
  return { enqueued: 0 };
}

async function loadMoreChannel(channelId) {
  const { rows } = await pool.query(
    `SELECT c.*, u.username AS owner_username
     FROM channels c JOIN users u ON u.id = c.owner_id
     WHERE c.id = $1`,
    [channelId]
  );
  if (!rows[0]) return { enqueued: 0, pending: 0 };
  const start = rows[0].video_cursor || 1;
  return checkChannelRow(rows[0], 0, true, 25, start);
}

function fallbackChannelName(channel) {
  if (channel.channel_name && channel.channel_name !== 'NA') return channel.channel_name;
  const match = channel.channel_url.match(/@([^/?#]+)/);
  return match ? `@${match[1]}` : 'Canal sin nombre';
}

async function downloadThumbnail(ch, video) {
  const thumbnailUrl = video.thumbnail || (video.id ? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg` : null);
  if (!thumbnailUrl) return null;
  const thumbnailDir = path.join(cfg.mediaRoot, ch.owner_username, '.pending');
  fs.mkdirSync(thumbnailDir, { recursive: true });
  const fileName = `${video.id}.jpg`;
  const fullPath = path.join(thumbnailDir, fileName);
  try {
    const response = await fetch(thumbnailUrl, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    fs.writeFileSync(fullPath, Buffer.from(await response.arrayBuffer()));
    return path.join(ch.owner_username, '.pending', fileName);
  } catch (err) {
    console.warn(`[channels] No se pudo descargar thumbnail de ${video.url}:`, err.message);
    return null;
  }
}

async function createPendingMedia(ch, video) {
  const thumbnailPath = await downloadThumbnail(ch, video);
  await pool.query(
    `INSERT INTO media
      (owner_id, media_type, title, channel_name, thumbnail_path, source_url, pending_download, is_incognito)
     VALUES ($1,'video',$2,$3,$4,$5,TRUE,FALSE)`,
    [ch.owner_id, video.title || video.id, video.channelName || fallbackChannelName(ch), thumbnailPath, video.url]
  );
}

async function checkChannelRow(ch, downloadCount = Infinity, createPending = false, listLimit, start = 1) {
  try {
    const videos = await ytdlp.listChannelVideos(ch.channel_url, listLimit, start);
    // Solo consideramos "nuevo" lo publicado despues del ultimo check
    // (heuristica simple: yt-dlp --flat-playlist no trae fecha exacta sin
    // costo extra, asi que limitamos a los N mas recientes del listado)
    const restrictedAvailability = new Set(['subscriber_only', 'needs_subscription', 'premium_only', 'private', 'needs_auth']);
    const availableVideos = videos.filter((video) => !restrictedAvailability.has(video.availability));
    const excluded = videos.length - availableVideos.length;
    const recent = createPending ? availableVideos : availableVideos.slice(0, 5);

    const { rows: known } = await pool.query(
      `SELECT source_url AS url FROM media WHERE owner_id = $1
       UNION
       SELECT url FROM download_jobs WHERE owner_id = $1 AND status IN ('queued', 'running')`,
      [ch.owner_id]
    );
    const knownUrls = new Set(known.map((r) => r.url));
    let enqueued = 0;
    let pending = 0;

    for (const [index, v] of recent.entries()) {
      if (!knownUrls.has(v.url)) {
        if (index < downloadCount) {
          await jobs.enqueueDownload({
            ownerIdForDb: ch.owner_id,
            userDirName: ch.owner_username,
            url: v.url,
            options: { mode: 'video', quality: 'best', isPlaylist: false, channelName: fallbackChannelName(ch) },
            isIncognito: false,
          });
          enqueued += 1;
        } else {
          await createPendingMedia(ch, v);
          pending += 1;
        }
        knownUrls.add(v.url);
      }
    }

    const nextCursor = start + videos.length;
    await pool.query(
      createPending
        ? 'UPDATE channels SET last_checked_at = now(), video_cursor = $1 WHERE id = $2'
        : 'UPDATE channels SET last_checked_at = now() WHERE id = $1',
      createPending ? [nextCursor, ch.id] : [ch.id]
    );
    return { enqueued, pending, excluded, hasMore: createPending ? videos.length === listLimit : undefined };
  } catch (err) {
    throw new Error(`No se pudo revisar ${ch.channel_url}: ${err.message}`);
  }
}

module.exports = { checkAllChannels, checkChannel, loadMoreChannel };
