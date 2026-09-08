/*
 * Applies the saved theme before the first paint.
 *
 * The widget and the quick-capture window appear and disappear constantly, so
 * a flash of the wrong colours would be a large fraction of every appearance.
 * Each window reads its own surface's preferences: the widget is legitimately
 * denser and more translucent than the main window.
 */
(function () {
  try {
    var path = location.pathname;
    var surface = path.indexOf('widget') >= 0 ? 'widget'
      : path.indexOf('quick') >= 0 ? 'quick'
      : 'desktop';

    var raw = localStorage.getItem('recall.preferences.' + surface);
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
    if (theme.surfaceAlpha) root.style.setProperty('--rc-surface-alpha', String(theme.surfaceAlpha));
  } catch (error) {
    /* Blocked storage is not a reason to fail to render. */
  }
})();
