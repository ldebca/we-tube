'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mime = require('../server/routes/mimeHelper');

test('lookup: resuelve tipos de video, audio e imagen conocidos', () => {
  assert.equal(mime.lookup('/a/b/movie.mp4'), 'video/mp4');
  assert.equal(mime.lookup('song.MP3'), 'audio/mpeg');
  assert.equal(mime.lookup('photo.PNG'), 'image/png');
});

test('lookup: devuelve octet-stream para extensiones desconocidas', () => {
  assert.equal(mime.lookup('archivo.xyz'), 'application/octet-stream');
});
