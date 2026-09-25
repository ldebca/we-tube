// app.js — utilidades compartidas por todas las paginas
window.WT = (function () {
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
      ? `<span class="text-xs px-2 py-1 rounded-full" style="background:var(--accent-soft);color:var(--accent)">🕶 Incognito</span>`
      : '';
    document.getElementById('wt-nav').innerHTML = `
      <div class="flex items-center justify-between px-4 md:px-6 h-16 border-b" style="border-color:var(--border)">
        <div class="flex items-center gap-6">
          <a href="/index.html" class="flex items-center"><img src="/assets/logo.svg" class="h-6" alt="we-tube"/></a>
          <div class="hidden md:flex items-center gap-1 flex-1 min-w-[320px]">
            <input id="wt-search" type="text" placeholder="Buscar en tu catalogo..." class="!rounded-r-none" style="max-width:420px"/>
            <button id="wt-search-btn" class="btn-ghost !rounded-l-none">🔎</button>
          </div>
        </div>
        <div class="flex items-center gap-2">
          ${incognitoBadge}
          <a href="/upload.html" class="sidebar-link ${activePage === 'upload' ? 'active' : ''}">⬆️ <span class="hidden md:inline">Subir</span></a>
          <a href="/download.html" class="sidebar-link ${activePage === 'download' ? 'active' : ''}">⬇️ <span class="hidden md:inline">Descargar</span></a>
          <button data-theme-icon onclick="WTTheme.toggle()" class="btn-ghost">🌙</button>
          <a href="/settings.html" class="btn-ghost">⚙️</a>
          <span class="text-sm hidden md:inline" style="color:var(--text-muted)">${user ? user.username : ''}</span>
          <button id="wt-logout" class="btn-ghost">Salir</button>
        </div>
      </div>`;

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

  return { toast, fmtViews, fmtDuration, fmtDate, fmtBytes, guard, renderNav };
})();
