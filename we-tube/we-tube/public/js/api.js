// api.js — cliente fetch minimalista (cookies httpOnly manejan la sesion)
window.WTApi = (function () {
  async function req(path, opts = {}) {
    const res = await fetch('/api' + path, {
      credentials: 'include',
      headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      ...opts,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* respuesta sin cuerpo */ }
    if (!res.ok) throw new Error((data && data.error) || `Error ${res.status}`);
    return data;
  }

  return {
    me: () => req('/auth/me'),
    login: (username, password) => req('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
    register: (username, email, password) => req('/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password }) }),
    incognito: () => req('/auth/incognito', { method: 'POST' }),
    logout: () => req('/auth/logout', { method: 'POST' }),

    listMedia: (q, type) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (type) params.set('type', type);
      return req('/media?' + params.toString());
    },
    getMedia: (id) => req('/media/' + id),
    deleteMedia: (id) => req('/media/' + id, { method: 'DELETE' }),
    toggleFavorite: (id) => req('/media/' + id + '/favorite', { method: 'POST' }),

    ytdlpVersion: () => req('/downloads/version'),
    startDownload: (payload) => req('/downloads', { method: 'POST', body: JSON.stringify(payload) }),
    getJob: (id) => req('/downloads/' + id),
    deleteJob: (id) => req('/downloads/' + id, { method: 'DELETE' }),
    listJobs: () => req('/downloads'),

    upload: (file, onProgress) => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload');
        xhr.withCredentials = true;
        xhr.upload.onprogress = (e) => {
          if (onProgress && e.lengthComputable) onProgress((e.loaded / e.total) * 100);
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
          else reject(new Error(JSON.parse(xhr.responseText || '{}').error || 'Error al subir'));
        };
        xhr.onerror = () => reject(new Error('Error de red al subir el archivo'));
        const fd = new FormData();
        fd.append('file', file);
        xhr.send(fd);
      });
    },

    listChannels: () => req('/channels'),
    addChannel: (channelUrl, channelName, initialDownloadCount) => req('/channels', {
      method: 'POST',
      body: JSON.stringify({ channelUrl, channelName, initialDownloadCount }),
    }),
    loadMoreChannel: (id) => req('/channels/' + id + '/more', { method: 'POST' }),
    removeChannel: (id) => req('/channels/' + id, { method: 'DELETE' }),
    checkChannelsNow: () => req('/channels/check-now', { method: 'POST' }),

    getConfig: () => req('/config'),
    saveConfig: (cfg) => req('/config', { method: 'PUT', body: JSON.stringify(cfg) }),
  };
})();
