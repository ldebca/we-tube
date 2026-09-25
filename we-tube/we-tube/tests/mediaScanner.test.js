'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classify } = require('../server/services/mediaScanner');

test('classify: reconoce extensiones de video', () => {
  assert.equal(classify('.mp4'), 'video');
  assert.equal(classify('.MKV'), 'video');
});

test('classify: reconoce extensiones de audio', () => {
  assert.equal(classify('.mp3'), 'audio');
  assert.equal(classify('.M4A'), 'audio');
});

test('classify: reconoce extensiones de imagen', () => {
  assert.equal(classify('.png'), 'image');
  assert.equal(classify('.WEBP'), 'image');
});

test('classify: devuelve null para extensiones no soportadas', () => {
  assert.equal(classify('.exe'), null);
  assert.equal(classify('.txt'), null);
});
