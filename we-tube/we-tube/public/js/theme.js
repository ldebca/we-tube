// theme.js — modo claro/oscuro (requisito 14)
(function () {
  const KEY = 'wt_theme';
  const LOGOS = {
    light: '/assets/logo-ligth.svg',
    dark: '/assets/logo-dark.svg'
  };

  function updateLogos(theme) {
    document.querySelectorAll('[data-theme-logo]').forEach((logo) => {
      logo.src = LOGOS[theme] || LOGOS.light;
    });
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(KEY, theme);
    updateLogos(theme);
    document.querySelectorAll('[data-theme-icon]').forEach((el) => {
      el.setAttribute('data-lucide', theme === 'dark' ? 'sun' : 'moon');
    });
    if (window.WT && window.WT.refreshIcons) window.WT.refreshIcons();
  }
  function init() {
    const saved = localStorage.getItem(KEY) ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    apply(saved);
  }
  function toggle() {
    const current = document.documentElement.getAttribute('data-theme');
    apply(current === 'dark' ? 'light' : 'dark');
  }
  document.addEventListener('DOMContentLoaded', () => {
    updateLogos(document.documentElement.getAttribute('data-theme') || 'light');
  });
  window.WTTheme = { init, toggle };
  init();
})();
