// theme.js — modo claro/oscuro (requisito 14)
(function () {
  const KEY = 'wt_theme';
  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(KEY, theme);
    document.querySelectorAll('[data-theme-icon]').forEach((el) => {
      el.textContent = theme === 'dark' ? '☀️' : '🌙';
    });
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
  window.WTTheme = { init, toggle };
  init();
})();
