/*
 * Applies the saved theme before the first paint.
 *
 * The widget and the quick-capture window appear and disappear constantly, so
 * a flash of the wrong colours would be a large fraction of every appearance.
 * That is the whole reason preferences live in localStorage rather than in the
 * sync engine's store: this has to be readable synchronously.
 *
 * It deliberately mirrors `widgetTheme` and `opaqueTheme` from @recall/ui.
 * Duplicating them is the cost of running before any module loads; the shapes
 * are pinned by a test so the two cannot drift apart unnoticed.
 */
(function () {
  var SHARED_KEY = 'recall.preferences.theme';
  var WIDGET_ALPHA_FACTOR = 0.82;
  var WIDGET_ROW_HEIGHT_DELTA = -4;

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
    var path = location.pathname;
    var surface =
      path.indexOf('widget') >= 0 ? 'widget' : path.indexOf('quick') >= 0 ? 'quick' : 'desktop';

    // Appearance is one shared record for every window. A record written before
    // that was true still carries a theme inline, so fall back to it — except
    // on the widget, whose old copy held seeded defaults rather than a choice.
    var theme = read(SHARED_KEY);
    if (!theme && surface !== 'widget') {
      var legacy = read('recall.preferences.' + surface);
      theme = legacy && legacy.theme;
    }
    theme = theme || {};

    // Only the widget and the capture bar are transparent windows with the
    // desktop behind them; anywhere else translucency is legibility spent for
    // no effect.
    var overDesktop = surface === 'widget' || surface === 'quick';

    var root = document.documentElement;
    var mode = theme.mode || 'system';
    root.dataset.theme = mode;
    if (mode === 'system') {
      root.dataset.systemDark = String(window.matchMedia('(prefers-color-scheme: dark)').matches);
    }

    if (typeof theme.accent === 'string' && /^#[0-9a-f]{6}$/i.test(theme.accent)) {
      root.style.setProperty('--rc-accent', theme.accent);
    }

    var rowHeight = clamp(theme.rowHeight, 26, 56);
    if (rowHeight !== null) {
      var rows = overDesktop ? clamp(rowHeight + WIDGET_ROW_HEIGHT_DELTA, 26, 56) : rowHeight;
      root.style.setProperty('--rc-row-height', Math.round(rows) + 'px');
    }

    var fontScale = clamp(theme.fontScale, 0.85, 1.4);
    if (fontScale !== null) root.style.setProperty('--rc-font-scale', String(fontScale));

    var alpha = clamp(theme.surfaceAlpha, 0.35, 1);
    root.style.setProperty(
      '--rc-surface-alpha',
      overDesktop ? String(clamp((alpha === null ? 1 : alpha) * WIDGET_ALPHA_FACTOR, 0.35, 1)) : '1',
    );
  } catch (error) {
    /* Blocked storage is not a reason to fail to render. */
  }
})();
