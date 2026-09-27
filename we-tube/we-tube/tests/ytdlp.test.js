// tests/ytdlp.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ytdlp = require('../server/services/ytdlp');

test('buildArgs: modo video usa -f con altura solicitada', () => {
  const args = ytdlp.buildArgs({ url: 'https://youtu.be/abc', mode: 'video', quality: '720' }, '/tmp/out');
  const fIndex = args.indexOf('-f');
  assert.ok(fIndex !== -1, 'debe incluir el flag -f');
  assert.match(args[fIndex + 1], /height<=720/);
  assert.ok(args.includes('--no-playlist'), 'sin isPlaylist debe forzar --no-playlist');
  assert.equal(args[args.length - 1], 'https://youtu.be/abc', 'la URL debe ir al final');
});

test('buildArgs: modo audio usa -x y --audio-format', () => {
  const args = ytdlp.buildArgs({ url: 'https://youtu.be/abc', mode: 'audio', audioFormat: 'mp3' }, '/tmp/out');
  assert.ok(args.includes('-x'));
  const idx = args.indexOf('--audio-format');
  assert.equal(args[idx + 1], 'mp3');
});

test('buildArgs: playlist activa --yes-playlist y respeta playlistItems', () => {
  const args = ytdlp.buildArgs(
    { url: 'https://youtube.com/playlist?list=xyz', mode: 'video', isPlaylist: true, playlistItems: '1-3' },
    '/tmp/out'
  );
  assert.ok(args.includes('--yes-playlist'));
  const idx = args.indexOf('--playlist-items');
  assert.equal(args[idx + 1], '1-3');
});

test('buildArgs: extraArgs se agregan tal cual para control total del usuario avanzado', () => {
  const args = ytdlp.buildArgs(
    { url: 'https://youtu.be/abc', mode: 'video', extraArgs: '--sponsorblock-remove sponsor --embed-chapters' },
    '/tmp/out'
  );
  assert.ok(args.includes('--sponsorblock-remove'));
  assert.ok(args.includes('sponsor'));
  assert.ok(args.includes('--embed-chapters'));
});

test('buildArgs: la plantilla de salida apunta al directorio del usuario', () => {
  const outDir = '/media/johndoe';
  const args = ytdlp.buildArgs({ url: 'https://youtu.be/abc', mode: 'video' }, outDir);
  const idx = args.indexOf('-o');
  assert.ok(args[idx + 1].startsWith(outDir));
  assert.ok(args[idx + 1].includes(path.sep) || args[idx + 1].includes('/'));
});

test('buildArgs: subtitulos agrega flags correctos con idiomas por defecto', () => {
  const args = ytdlp.buildArgs({ url: 'https://youtu.be/abc', mode: 'video', subtitles: true }, '/tmp/out');
  assert.ok(args.includes('--write-subs'));
  assert.ok(args.includes('--write-auto-subs'));
  const idx = args.indexOf('--sub-langs');
  assert.equal(args[idx + 1], 'es,en');
});

test('classifyVideoKind: identifica normales, shorts y live a partir de metadata de yt-dlp', () => {
  assert.equal(ytdlp.classifyVideoKind({ live_status: 'not_live', webpage_url: 'https://www.youtube.com/watch?v=abc123' }), 'normal');
  assert.equal(ytdlp.classifyVideoKind({ is_short: true, webpage_url: 'https://www.youtube.com/shorts/abc123' }), 'short');
  assert.equal(ytdlp.classifyVideoKind({ live_status: 'is_live', webpage_url: 'https://www.youtube.com/watch?v=live123' }), 'live');
  assert.equal(ytdlp.classifyVideoKind({ live_status: 'was_live', webpage_url: 'https://www.youtube.com/watch?v=done123' }), 'live');
  assert.equal(ytdlp.classifyVideoKind({ live_status: 'is_upcoming', webpage_url: 'https://www.youtube.com/watch?v=upcoming123' }), 'live');
  assert.equal(ytdlp.classifyVideoKind({ video_kind: 'normal', source_url: 'https://www.youtube.com/shorts/abc123' }), 'short');
  assert.equal(ytdlp.classifyVideoKind({ video_kind: 'normal', source_url: 'https://www.youtube.com/watch?v=live123', live_status: 'is_live' }), 'live');
});

test('listChannelVideos: las opciones de paginacion van antes de --print y agrega metadata de tipo', () => {
  const source = require('fs').readFileSync(path.join(__dirname, '../server/services/ytdlp.js'), 'utf8');
  assert.match(source, /const args = \['--flat-playlist'\];[\s\S]*args\.push\('--playlist-start'/);
  assert.match(source, /args\.push\(\s*'--print',\s*'%\(id\)s\|\|\|%\(title\)s/i);
  assert.match(source, /is_short|live_status/i);
});
