/*
 * Applies the saved theme before the first paint.
 *
 * The popup is on screen for a couple of seconds at a time, so a flash of the
 * wrong colours would be a large fraction of every appearance. Preferences are
 * mirrored into localStorage precisely so this can run synchronously.
 *
 * Lives in public/ rather than src/ because it is a classic script, not a
 * module: Vite copies it verbatim instead of trying to bundle it.
 */
(function () {
  try {
    var raw = localStorage.getItem('recall.preferences.extension');
    var theme = raw ? JSON.parse(raw).theme || {} : {};
    var mode = theme.mode || 'system';
    var root = document.documentElement;

    root.dataset.theme = mode;
    if (mode === 'system') {
      root.dataset.systemDark = String(window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    if (theme.accent) root.style.setProperty('--rc-accent', theme.accent);
    if (theme.rowHeight) root.style.setProperty('--rc-row-height', theme.rowHeight + 'px');
    if (theme.fontScale) root.style.setProperty('--rc-font-scale', String(theme.fontScale));
  } catch (error) {
    /* Blocked storage is not a reason to fail to render. */
  }
})();
