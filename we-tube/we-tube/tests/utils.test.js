'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { resolveUserStorage } = require('../server/utils');

test('resolveUserStorage: usuario normal usa su username como carpeta', () => {
  const identity = resolveUserStorage({ sub: 'user-uuid-1', username: 'johndoe', incognito: false });
  assert.equal(identity.dirName, 'johndoe');
  assert.equal(identity.ownerIdForDb, 'user-uuid-1');
  assert.equal(identity.isIncognito, false);
});

test('resolveUserStorage: usuario incognito usa carpeta temporal aislada', () => {
  const identity = resolveUserStorage({
    sub: 'incog-session-1',
    username: 'Incognito',
    incognito: true,
    incognitoSessionId: 'session-1',
  });
  assert.equal(identity.dirName, path.join('_incognito', 'session-1'));
  assert.equal(identity.ownerIdForDb, null);
  assert.equal(identity.isIncognito, true);
  assert.equal(identity.incognitoSessionId, 'session-1');
});
