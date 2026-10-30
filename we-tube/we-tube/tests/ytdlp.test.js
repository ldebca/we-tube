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

test('buildArgs: multistream descarga todas las pistas de audio en MKV', () => {
  const args = ytdlp.buildArgs({ url: 'https://youtu.be/abc', mode: 'video', audioMultistreams: true }, '/tmp/out');
  assert.ok(args.includes('--audio-multistreams'));
  const mergeIndex = args.indexOf('--merge-output-format');
  assert.equal(args[mergeIndex + 1], 'mkv');
  assert.match(args[args.indexOf('-f') + 1], /mergeall\[vcodec=none\]/);
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

test('buildArgs: opciones avanzadas agregan flags de personalizacion', () => {
  const args = ytdlp.buildArgs({
    url: 'https://youtu.be/abc',
    mode: 'video',
    embedThumbnail: true,
    embedChapters: true,
    sponsorblockRemove: 'sponsor,intro',
    liveFromStart: true,
    retries: '4',
    fragmentRetries: '6',
    sleepInterval: '2',
    maxSleepInterval: '5',
    dateAfter: '20240101',
    dateBefore: '20241231',
  }, '/tmp/out');
  assert.ok(args.includes('--embed-thumbnail'));
  assert.ok(args.includes('--embed-chapters'));
  assert.deepEqual(args.slice(args.indexOf('--sponsorblock-remove'), args.indexOf('--sponsorblock-remove') + 2), ['--sponsorblock-remove', 'sponsor,intro']);
  assert.ok(args.includes('--live-from-start'));
  assert.ok(args.includes('--retries') && args.includes('4'));
  assert.ok(args.includes('--fragment-retries') && args.includes('6'));
  assert.ok(args.includes('--sleep-interval') && args.includes('2'));
  assert.ok(args.includes('--max-sleep-interval') && args.includes('5'));
  assert.ok(args.includes('--dateafter') && args.includes('20240101'));
  assert.ok(args.includes('--datebefore') && args.includes('20241231'));
});

test('classifyVideoKind: identifica normales, shorts y live a partir de metadata de yt-dlp', () => {
  assert.equal(ytdlp.classifyVideoKind({ live_status: 'not_live', webpage_url: 'https://www.youtube.com/watch?v=abc123' }), 'normal');
  assert.equal(ytdlp.classifyVideoKind({ is_short: true, webpage_url: 'https://www.youtube.com/shorts/abc123' }), 'short');
  assert.equal(ytdlp.classifyVideoKind({ live_status: 'is_live', webpage_url: 'https://www.youtube.com/watch?v=live123' }), 'live');
  assert.equal(ytdlp.classifyVideoKind({ live_status: 'was_live', webpage_url: 'https://www.youtube.com/watch?v=done123' }), 'live');
  assert.equal(ytdlp.classifyVideoKind({ live_status: 'is_upcoming', webpage_url: 'https://www.youtube.com/watch?v=upcoming123' }), 'live');
  assert.equal(ytdlp.classifyVideoKind({ video_kind: 'normal', source_url: 'https://www.youtube.com/shorts/abc123' }), 'short');
  assert.equal(ytdlp.classifyVideoKind({ url: 'https://www.youtube.com/shorts/abc123' }), 'short');
  assert.equal(ytdlp.classifyVideoKind({ video_kind: 'normal', source_url: 'https://www.youtube.com/watch?v=live123', live_status: 'is_live' }), 'live');
});

test('listChannelVideos: las opciones de paginacion van antes de --print y agrega metadata de tipo', () => {
  const source = require('fs').readFileSync(path.join(__dirname, '../server/services/ytdlp.js'), 'utf8');
  assert.match(source, /const args = \['--flat-playlist'\];[\s\S]*args\.push\('--playlist-start'/);
  assert.match(source, /args\.push\(\s*'--print',\s*'%\(id\)s\|\|\|%\(title\)s/i);
  assert.match(source, /is_short|live_status|channel|channel_thumbnail|getChannelMetadata/i);
});
