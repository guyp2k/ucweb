(() => {
  let saved = null;
  try {
    saved = localStorage.getItem('ucweb.theme');
  } catch {
    saved = null;
  }
  if (saved && /^[a-z0-9-]+$/.test(saved)) {
    document.documentElement.dataset.theme = saved;
    document.getElementById('theme-css').href = `/themes/${saved}/theme.css`;
  }
})();
