'use strict';

const path = require('path');

function normalizeText(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const str = String(value).trim();
  if (!str) return fallback;
  return str;
}

function normalizeUploadMetadata(input = {}, defaultFileName = '') {
  const fallbackTitle = normalizeText(path.parse(defaultFileName || '').name) || 'Archivo sin título';
  const title = normalizeText(input.title, fallbackTitle);
  const channelName = normalizeText(input.channel);
  const authorName = normalizeText(input.author);
  const description = normalizeText(input.description);
  const sourceUrl = normalizeText(input.sourceUrl);
  const thumbnailPath = normalizeText(input.thumbnailPath);

  return {
    title,
    channel_name: channelName,
    author_name: authorName,
    description,
    source_url: sourceUrl,
    thumbnail_path: thumbnailPath,
  };
}

module.exports = { normalizeText, normalizeUploadMetadata };
