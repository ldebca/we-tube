// tests/uploadMetadata.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeUploadMetadata } = require('../server/services/uploadMetadata');
const { generateAutoThumbnail } = require('../server/services/autoThumbnail');

test('normalizeUploadMetadata: rellena defaults y limpia valores de usuario', () => {
  const result = normalizeUploadMetadata({
    title: '   ',
    channel: '   Canal Demo   ',
    author: '   Autor Demo   ',
    description: '   texto extra   ',
    sourceUrl: '  https://example.com/video  ',
  }, 'clip.mp4');

  assert.equal(result.title, 'clip');
  assert.equal(result.channel_name, 'Canal Demo');
  assert.equal(result.author_name, 'Autor Demo');
  assert.equal(result.description, 'texto extra');
  assert.equal(result.source_url, 'https://example.com/video');
});

test('normalizeUploadMetadata: descarta urls vacias y guarda miniatura opcional', () => {
  const result = normalizeUploadMetadata({
    title: 'Mi video',
    channel: '',
    author: '  ',
    description: '',
    sourceUrl: '   ',
    thumbnailPath: 'uploads/user/thumb.jpg',
  }, 'mi-video.mp4');

  assert.equal(result.title, 'Mi video');
  assert.equal(result.channel_name, null);
  assert.equal(result.author_name, null);
  assert.equal(result.description, null);
  assert.equal(result.source_url, null);
  assert.equal(result.thumbnail_path, 'uploads/user/thumb.jpg');
});

test('generateAutoThumbnail: crea una miniatura por defecto para audio cuando no hay ffmpeg', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-thumb-'));
  const source = path.join(dir, 'demo-audio.mp3');
  fs.writeFileSync(source, 'fake-audio');

  const result = generateAutoThumbnail({
    sourcePath: source,
    outputDir: dir,
    mediaType: 'audio',
    originalName: 'demo-audio.mp3',
    customTitle: 'Mi canción favorita',
  });

  assert.equal(result.generated, true);
  assert.ok(result.thumbnailPath);
  assert.ok(fs.existsSync(result.thumbnailPath));
  assert.match(fs.readFileSync(result.thumbnailPath, 'utf8'), /Mi canción favorita/i);
});
