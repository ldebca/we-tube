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

const VIDEO_KINDS = ['normal', 'short', 'live'];
const RECENT_CHANNEL_ITEMS = 5;

function normalizeVideoKinds(value) {
  if (!Array.isArray(value)) return null;
  const kinds = [...new Set(value.map((kind) => String(kind).trim()).filter((kind) => VIDEO_KINDS.includes(kind)))];
  return kinds.length ? kinds : null;
}

async function removeChannel(channelId, ownerId) {
  const { rows } = await pool.query(
    `SELECT c.*, u.username AS owner_username
     FROM channels c JOIN users u ON u.id = c.owner_id
     WHERE c.id = $1 AND c.owner_id = $2`,
    [channelId, ownerId]
  );
  const channel = rows[0];
  if (!channel) return null;

  const canonicalName = fallbackChannelName(channel);
  const mediaResult = await pool.query(
    `SELECT id, relative_path, thumbnail_path FROM media
     WHERE owner_id = $1 AND (channel_id = $2 OR channel_name = $3)`,
    [ownerId, channelId, canonicalName]
  );
  for (const media of mediaResult.rows) {
    const paths = [media.relative_path, media.thumbnail_path].filter(Boolean);
    for (const relativePath of paths) {
      const fullPath = path.join(cfg.mediaRoot, relativePath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
  }

  jobs.cancelQueuedChannel(channelId);
  await pool.query('DELETE FROM download_jobs WHERE owner_id = $1 AND channel_id = $2 AND status = $3', [ownerId, channelId, 'queued']);
  await pool.query(
    'DELETE FROM media WHERE owner_id = $1 AND (channel_id = $2 OR channel_name = $3)',
    [ownerId, channelId, canonicalName]
  );
  await pool.query('DELETE FROM channels WHERE id = $1 AND owner_id = $2', [channelId, ownerId]);
  return { mediaDeleted: mediaResult.rowCount };
}

async function checkAllChannels() {
  const { rows: channels } = await pool.query(
    `SELECT c.*, u.username AS owner_username
     FROM channels c JOIN users u ON u.id = c.owner_id`
  );
  for (const ch of channels) {
    try {
      await checkChannelRow(ch, Infinity, false, ch.channel_scan_limit || 5, 1);
    } catch (err) {
      console.error(`[channels] Error revisando canal ${ch.channel_url}:`, err.message);
    }
  }
}

async function checkChannel(channelId, initialDownloadCount = 1) {
  const { rows } = await pool.query(
    `SELECT c.*, u.username AS owner_username
     FROM channels c JOIN users u ON u.id = c.owner_id
     WHERE c.id = $1`,
    [channelId]
  );
  if (rows[0]) return checkChannelRow(rows[0], initialDownloadCount, true, rows[0].channel_scan_limit || 5, 1);
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
  return checkChannelRow(rows[0], 0, true, RECENT_CHANNEL_ITEMS, 1);
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

async function createPendingMedia(ch, video, orderIndex = 0) {
  const thumbnailPath = await downloadThumbnail(ch, video);
  const videoKind = ytdlp.classifyVideoKind(video);
  const publishedAt = /^\d{8}$/.test(String(video.upload_date || ''))
    ? new Date(`${video.upload_date.slice(0, 4)}-${video.upload_date.slice(4, 6)}-${video.upload_date.slice(6, 8)}`)
    : null;
  const pendingSortAt = new Date(Date.now() - orderIndex * 1000);
  await pool.query(
    `INSERT INTO media
      (owner_id, channel_id, media_type, video_kind, title, channel_name, published_at, pending_sort_at, thumbnail_path, source_url, pending_download, is_incognito)
     VALUES ($1,$2,'video',$3,$4,$5,$6,$7,$8,$9,TRUE,FALSE)`,
    [ch.owner_id, ch.id, videoKind, video.title || video.id, video.channelName || fallbackChannelName(ch), publishedAt, pendingSortAt, thumbnailPath, video.url]
  );
}

async function checkChannelRow(ch, downloadCount = Infinity, createPending = false, listLimit, start = 1) {
  try {
    const videos = await ytdlp.listChannelVideos(ch.channel_url, listLimit, start);
    const detectedChannelName = videos.find((video) => video.channelName && video.channelName !== 'NA')?.channelName;
    let detectedChannelThumbnail = videos.find((video) => video.channelThumbnail && video.channelThumbnail !== 'NA')?.channelThumbnail;
    let metadataChannelName = null;
    if (!detectedChannelThumbnail) {
      const channelMetadata = await ytdlp.getChannelMetadata(ch.channel_url);
      detectedChannelThumbnail = channelMetadata?.channelThumbnail || null;
      metadataChannelName = channelMetadata?.channelName || null;
    }
    if (detectedChannelName || metadataChannelName || detectedChannelThumbnail) {
      ch.channel_name = detectedChannelName || metadataChannelName || ch.channel_name;
      ch.channel_thumbnail = detectedChannelThumbnail || ch.channel_thumbnail;
      await pool.query(
        'UPDATE channels SET channel_name = COALESCE($1, channel_name), channel_thumbnail = COALESCE($2, channel_thumbnail) WHERE id = $3',
        [detectedChannelName || metadataChannelName || null, detectedChannelThumbnail || null, ch.id]
      );
    }
    // Solo consideramos "nuevo" lo publicado despues del ultimo check
    // (heuristica simple: yt-dlp --flat-playlist no trae fecha exacta sin
    // costo extra, asi que limitamos a los N mas recientes del listado)
    const restrictedAvailability = new Set(['subscriber_only', 'needs_subscription', 'premium_only', 'private', 'needs_auth']);
    const availableVideos = videos.filter((video) => !restrictedAvailability.has(video.availability));
    const allowedKinds = normalizeVideoKinds(ch.allowed_video_kinds) || VIDEO_KINDS;
    const filteredVideos = availableVideos.filter((video) => allowedKinds.includes(ytdlp.classifyVideoKind(video)));
    const excluded = videos.length - filteredVideos.length;
    const recent = createPending ? filteredVideos : filteredVideos.slice(0, 5);

    const { rows: known } = await pool.query(
      `SELECT source_url AS url FROM media WHERE owner_id = $1
       UNION
       SELECT url FROM download_jobs WHERE owner_id = $1 AND status IN ('queued', 'running')`,
      [ch.owner_id]
    );
    const knownUrls = new Set(known.map((r) => r.url));
    let enqueued = 0;
    let pending = 0;

    const canonicalName = fallbackChannelName(ch);
    for (const video of recent) {
      await pool.query(
        'UPDATE media SET channel_id = $1, channel_name = $2 WHERE owner_id = $3 AND source_url = $4',
        [ch.id, canonicalName, ch.owner_id, video.url]
      );
    }

    for (const [index, v] of recent.entries()) {
      if (!knownUrls.has(v.url)) {
        if (index < downloadCount) {
          await jobs.enqueueDownload({
            ownerIdForDb: ch.owner_id,
            channelId: ch.id,
            userDirName: ch.owner_username,
            url: v.url,
            options: {
              mode: 'video', quality: 'best', isPlaylist: false, channelName: canonicalName,
              videoKind: ytdlp.classifyVideoKind(v),
            },
            isIncognito: false,
          });
          enqueued += 1;
        } else {
          await createPendingMedia(ch, v, index);
          pending += 1;
        }
        knownUrls.add(v.url);
      }
    }

    const nextCursor = start + videos.length;
    await pool.query(
      createPending
      ? 'UPDATE channels SET last_checked_at = now(), video_cursor = GREATEST(video_cursor, $1) WHERE id = $2'
        : 'UPDATE channels SET last_checked_at = now() WHERE id = $1',
      createPending ? [nextCursor, ch.id] : [ch.id]
    );
    return { enqueued, pending, excluded, hasMore: createPending ? videos.length === listLimit : undefined };
  } catch (err) {
    throw new Error(`No se pudo revisar ${ch.channel_url}: ${err.message}`);
  }
}

module.exports = { checkAllChannels, checkChannel, loadMoreChannel, removeChannel, normalizeVideoKinds };
