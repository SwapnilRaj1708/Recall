/*
 * Applies the saved theme before the first paint.
 *
 * The popup is on screen for a couple of seconds at a time, so a flash of the
 * wrong colours would be a large fraction of every appearance. Preferences are
 * mirrored into localStorage precisely so this can run synchronously.
 *
 * Lives in public/ rather than src/ because it is a classic script, not a
 * module: Vite copies it verbatim instead of trying to bundle it.
 *
 * The popup is an ordinary opaque surface, so it mirrors `opaqueTheme` from
 * @recall/ui and ignores the transparency setting, which exists for the
 * desktop widget.
 */
(function () {
  var SHARED_KEY = 'recall.preferences.theme';

  function clamp(value, min, max) {
    return typeof value === 'number' && isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : null;
  }

  function read(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  try {
    // Appearance is one shared record across surfaces. A record written before
    // that was true still carries a theme inline, so fall back to it.
    var theme = read(SHARED_KEY);
    if (!theme) {
      var legacy = read('recall.preferences.extension');
      theme = legacy && legacy.theme;
    }
    theme = theme || {};

    var root = document.documentElement;
    var mode = theme.mode || 'system';

    root.dataset.theme = mode;
    if (mode === 'system') {
      root.dataset.systemDark = String(window.matchMedia('(prefers-color-scheme: dark)').matches);
    }

    if (typeof theme.accent === 'string' && /^#[0-9a-f]{6}$/i.test(theme.accent)) {
      root.style.setProperty('--rc-accent', theme.accent);
    }

    var rowHeight = clamp(theme.rowHeight, 22, 56);
    if (rowHeight !== null) root.style.setProperty('--rc-row-height', Math.round(rowHeight) + 'px');

    var fontScale = clamp(theme.fontScale, 0.85, 1.4);
    if (fontScale !== null) root.style.setProperty('--rc-font-scale', String(fontScale));

    root.style.setProperty('--rc-surface-alpha', '1');
  } catch (error) {
    /* Blocked storage is not a reason to fail to render. */
  }
})();
