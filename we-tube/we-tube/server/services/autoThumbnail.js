'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function sanitizeFileName(name) {
  const base = path.basename(name || 'upload').replace(/\.[^/.]+$/, '');
  return base.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'upload';
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildPlaceholderSvg(title, accent, customTitle) {
  const label = title === 'Audio' ? 'AUDIO' : 'VIDEO';
  const titleValue = escapeXml(customTitle && customTitle.trim() ? customTitle.trim() : (title === 'Audio' ? 'Audio' : 'Video'));

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img" aria-label="${titleValue}">
    <defs>
      <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="#0b1220"/>
        <stop offset="45%" stop-color="#111827"/>
        <stop offset="100%" stop-color="#1f2937"/>
      </linearGradient>
      <radialGradient id="glow" cx="30%" cy="30%" r="70%">
        <stop offset="0%" stop-color="${accent}" stop-opacity="0.8"/>
        <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1280" height="720" fill="url(#bg)"/>
    <rect x="0" y="0" width="1280" height="720" fill="url(#glow)"/>
    <g opacity="0.12" stroke="#ffffff" stroke-width="1">
      <path d="M0 120 H1280"/>
      <path d="M0 240 H1280"/>
      <path d="M0 360 H1280"/>
      <path d="M0 480 H1280"/>
      <path d="M0 600 H1280"/>
      <path d="M160 0 V720"/>
      <path d="M320 0 V720"/>
      <path d="M480 0 V720"/>
      <path d="M640 0 V720"/>
      <path d="M800 0 V720"/>
      <path d="M960 0 V720"/>
      <path d="M1120 0 V720"/>
    </g>

    <g transform="translate(150 170)">
      <rect x="0" y="0" width="320" height="220" rx="42" fill="${accent}" opacity="0.92"/>
      <path d="M118 66 L220 110 L118 154 Z" fill="#f8fafc"/>
      <circle cx="266" cy="132" r="18" fill="#f8fafc" opacity="0.18"/>
    </g>

    <g>
      <rect x="136" y="456" width="200" height="62" rx="31" fill="rgba(15,23,42,0.55)" stroke="rgba(255,255,255,0.12)"/>
      <text x="170" y="496" font-size="30" font-family="Arial, sans-serif" fill="#f8fafc" font-weight="700" letter-spacing="2">${label}</text>
    </g>

    <g>
      <text x="136" y="610" font-size="72" font-family="Arial, sans-serif" fill="#f8fafc" font-weight="700">${titleValue}</text>
      <text x="136" y="660" font-size="28" font-family="Arial, sans-serif" fill="#cbd5e1" opacity="0.85">Biblioteca local · we-tube</text>
    </g>
  </svg>
  `.trim();
}

function generateAutoThumbnail({ sourcePath, outputDir, mediaType, originalName, customTitle }) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { thumbnailPath: null, generated: false, reason: 'missing-source' };
  }

  const type = String(mediaType || 'video').toLowerCase();
  const targetBase = sanitizeFileName(originalName || sourcePath);
  const outputPath = path.join(outputDir, `${targetBase}-thumb.png`);
  const resolvedTitle = customTitle && String(customTitle).trim() ? String(customTitle).trim() : (path.parse(originalName || 'Video').name || 'Video');

  if (type === 'image') {
    return { thumbnailPath: null, generated: false, reason: 'image-origin' };
  }

  if (type === 'video') {
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    const result = spawnSync(ffmpegPath, [
      '-y',
      '-loglevel', 'error',
      '-ss', '00:00:02',
      '-i', sourcePath,
      '-vf', 'scale=1280:-2:flags=lanczos',
      '-frames:v', '1',
      outputPath,
    ], { stdio: 'ignore' });

    if (result.status === 0 && fs.existsSync(outputPath)) {
      return { thumbnailPath: outputPath, generated: true, reason: 'ffmpeg' };
    }
  }

  const fallbackLabel = type === 'audio' ? 'Audio' : 'Video';
  const fallbackPath = path.join(outputDir, `${targetBase}-thumb.svg`);
  fs.writeFileSync(
    fallbackPath,
    buildPlaceholderSvg(fallbackLabel, type === 'audio' ? '#8b5cf6' : '#f97316', resolvedTitle),
    'utf8'
  );

  return { thumbnailPath: fallbackPath, generated: true, reason: 'fallback' };
}

module.exports = { generateAutoThumbnail, buildPlaceholderSvg, sanitizeFileName, escapeXml };
