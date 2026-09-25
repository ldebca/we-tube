// app.js — utilidades compartidas por todas las paginas
window.WT = (function () {
  const WATCH_STATE_PREFIX = 'wt-watch-state:';
  const AUTOPLAY_PREFIX = 'wt-autoplay:';

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } });
  }

  function watchStateKey(user) {
    const identity = user && (user.id || user.username) || 'anonymous';
    return WATCH_STATE_PREFIX + identity;
  }

  function readWatchState(user) {
    try {
      return JSON.parse(localStorage.getItem(watchStateKey(user)) || '{}');
    } catch (e) {
      return {};
    }
  }

  function writeWatchState(user, state) {
    try {
      localStorage.setItem(watchStateKey(user), JSON.stringify(state));
    } catch (e) { /* localStorage puede estar deshabilitado */ }
  }

  function autoplayKey(user) {
    const identity = user && (user.id || user.username) || 'anonymous';
    return AUTOPLAY_PREFIX + identity;
  }

  function getAutoplay(user) {
    try {
      return localStorage.getItem(autoplayKey(user)) === 'true';
    } catch (e) {
      return false;
    }
  }

  function setAutoplay(user, enabled) {
    try {
      localStorage.setItem(autoplayKey(user), String(Boolean(enabled)));
    } catch (e) { /* localStorage puede estar deshabilitado */ }
  }

  function getWatchStatus(mediaId, user) {
    const entry = readWatchState(user)[mediaId];
    if (!entry) return { key: 'new', label: 'Nuevo' };
    if (entry.completed) return { key: 'watched', label: 'Visto' };
    return { key: 'progress', label: 'A medias', percent: entry.duration ? (entry.position / entry.duration) * 100 : 0 };
  }

  function savePlayback(mediaId, user, position, duration, completed) {
    const state = readWatchState(user);
    state[mediaId] = {
      position: Math.max(0, position || 0),
      duration: Math.max(0, duration || 0),
      completed: Boolean(completed),
      updatedAt: Date.now(),
    };
    writeWatchState(user, state);
  }

  function trackPlayback(mediaId, user, element) {
    let lastSavedAt = 0;
    const save = (completed) => {
      const now = Date.now();
      if (!completed && now - lastSavedAt < 3000) return;
      lastSavedAt = now;
      const duration = element.duration || 0;
      const position = element.currentTime || 0;
      savePlayback(mediaId, user, position, duration, completed || (duration > 0 && position / duration >= 0.9));
    };
    element.addEventListener('timeupdate', () => save(false));
    element.addEventListener('pause', () => save(false));
    element.addEventListener('ended', () => save(true));

    const entry = readWatchState(user)[mediaId];
    if (entry && !entry.completed) {
      element.addEventListener('loadedmetadata', () => {
        if (entry.position > 0 && entry.position < element.duration * 0.9) element.currentTime = entry.position;
      }, { once: true });
    }
  }

  function markViewed(mediaId, user) {
    savePlayback(mediaId, user, 1, 1, true);
  }

  function toast(msg, isError) {
    const el = document.createElement('div');
    el.className = 'toast';
    if (isError) el.style.borderColor = 'var(--danger)';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  function fmtViews(n) {
    if (n === null || n === undefined) return '';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M vistas';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K vistas';
    return n + ' vistas';
  }

  function fmtDuration(sec) {
    if (!sec) return '';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function fmtDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function fmtBytes(b) {
    if (!b) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
    return b.toFixed(1) + ' ' + units[i];
  }

  async function guard() {
    try {
      return await WTApi.me();
    } catch (e) {
      window.location.href = '/login.html';
      return null;
    }
  }

  function renderNav(activePage, user) {
    const incognitoBadge = user && user.incognito
      ? `<span class="text-xs px-2 py-1 rounded-full inline-flex items-center gap-1" style="background:var(--accent-soft);color:var(--accent)"><i data-lucide="incognito" class="badge-icon"></i> Incognito</span>`
      : '';
    document.getElementById('wt-nav').innerHTML = `
      <div class="flex items-center justify-between px-4 md:px-6 h-16 border-b" style="border-color:var(--border)">
        <div class="flex items-center gap-6">
          <a href="/index.html" class="flex items-center"><img src="/assets/logo.svg" class="h-6" alt="we-tube"/></a>
          <div class="hidden md:flex items-center gap-1 flex-1 min-w-[320px]">
            <input id="wt-search" type="text" placeholder="Buscar en tu catalogo..." class="!rounded-r-none" style="max-width:420px"/>
            <button id="wt-search-btn" class="btn-ghost !rounded-l-none icon-button" aria-label="Buscar"><i data-lucide="search" class="ui-icon"></i></button>
          </div>
        </div>
        <div class="flex items-center gap-2">
          ${incognitoBadge}
          <a href="/upload.html" class="sidebar-link ${activePage === 'upload' ? 'active' : ''}"><i data-lucide="upload" class="ui-icon"></i><span class="hidden md:inline">Subir</span></a>
          <a href="/download.html" class="sidebar-link ${activePage === 'download' ? 'active' : ''}"><i data-lucide="download" class="ui-icon"></i><span class="hidden md:inline">Descargar</span></a>
          <button data-theme-icon onclick="WTTheme.toggle()" class="btn-ghost icon-button" aria-label="Cambiar tema"><i data-lucide="moon" class="ui-icon"></i></button>
          <a href="/settings.html" class="btn-ghost icon-button" aria-label="Configuración"><i data-lucide="settings" class="ui-icon"></i></a>
          <span class="text-sm hidden md:inline" style="color:var(--text-muted)">${user ? user.username : ''}</span>
          <button id="wt-logout" class="btn-ghost"><i data-lucide="log-out" class="ui-icon"></i><span class="hidden md:inline">Salir</span></button>
        </div>
      </div>`;
    refreshIcons();

    document.getElementById('wt-logout').onclick = async () => {
      await WTApi.logout();
      window.location.href = '/login.html';
    };
    const searchBtn = document.getElementById('wt-search-btn');
    const searchInput = document.getElementById('wt-search');
    if (searchBtn) {
      const go = () => { window.location.href = '/index.html?q=' + encodeURIComponent(searchInput.value); };
      searchBtn.onclick = go;
      searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    }
  }

  const api = { toast, fmtViews, fmtDuration, fmtDate, fmtBytes, guard, renderNav, getWatchStatus, trackPlayback, markViewed, getAutoplay, setAutoplay, refreshIcons };
  refreshIcons();
  return api;
})();
