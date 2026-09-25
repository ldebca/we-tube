// utils.js
// Traduce un usuario autenticado (normal o incognito) a:
//  - dirName: subcarpeta dentro de media/ donde vive su contenido
//  - ownerIdForDb: UUID real (usuarios normales) o null (incognito, ya que
//    la tabla users no tiene una fila para sesiones fantasma)
'use strict';

const path = require('path');

function resolveUserStorage(user) {
  if (user.incognito) {
    return {
      dirName: path.join('_incognito', user.incognitoSessionId),
      ownerIdForDb: null,
      isIncognito: true,
      incognitoSessionId: user.incognitoSessionId,
    };
  }
  return { dirName: user.username, ownerIdForDb: user.sub, isIncognito: false, incognitoSessionId: null };
}

module.exports = { resolveUserStorage };
