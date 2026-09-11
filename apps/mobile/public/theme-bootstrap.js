/*
 * Applies the saved theme before the first paint.
 *
 * The phone app is opened and dismissed constantly, so a flash of the wrong
 * colours on every launch would be very visible. Mirrors `opaqueTheme` from
 * @recall/ui: the app window is opaque, so transparency — which exists for the
 * desktop widget — is pinned off.
 */
(function () {
  var SHARED_KEY = 'recall.preferences.theme';

  function clamp(value, min, max) {
    return typeof value === 'number' && isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : null;
  }

  try {
    var raw = localStorage.getItem(SHARED_KEY);
    var theme = raw ? JSON.parse(raw) : null;
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
