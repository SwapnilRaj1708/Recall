import { DEFAULT_THEME, opaqueTheme, widgetTheme } from '@recall/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  THEME_KEY,
  keyFor,
  loadPreferences,
  savePreferences,
  watchPreferences,
} from '../src/settings.js';

/**
 * Appearance is shared between windows; host settings are not.
 *
 * This split is load-bearing rather than cosmetic. The desktop widget has no
 * settings screen of its own, so anything stored under its own key is a
 * setting the user can never reach: an earlier version kept the whole theme
 * per-surface, and the effect was that the accent, row height and transparency
 * controls in the desktop app moved nothing on the one window they mattered
 * most for. These tests pin the storage layout that fixes it.
 */

class FakeStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  get raw(): Map<string, string> {
    return this.map;
  }
}

let store: FakeStorage;

beforeEach(() => {
  store = new FakeStorage();
  vi.stubGlobal('localStorage', store);
});

/** Simulate what the browser delivers to *other* windows after a write. */
function broadcast(key: string | null): void {
  const event = new Event('storage') as Event & { key: string | null };
  event.key = key;
  (globalThis.window as unknown as EventTarget).dispatchEvent(event);
}

describe('preference storage layout', () => {
  it('returns defaults when nothing has been stored', () => {
    expect(loadPreferences('desktop')).toEqual(DEFAULT_PREFERENCES);
  });

  it('writes the theme once, to a key no single surface owns', () => {
    savePreferences('desktop', {
      ...DEFAULT_PREFERENCES,
      theme: { ...DEFAULT_THEME, accent: '#b4741a', rowHeight: 46 },
    });

    const shared = JSON.parse(store.getItem(THEME_KEY)!);
    expect(shared.accent).toBe('#b4741a');
    expect(shared.rowHeight).toBe(46);

    // The surface's own record must not carry a second copy that could drift.
    const host = JSON.parse(store.getItem(keyFor('desktop'))!);
    expect(host).not.toHaveProperty('theme');
  });

  it('gives the widget the theme set in the desktop app', () => {
    savePreferences('desktop', {
      ...DEFAULT_PREFERENCES,
      theme: { ...DEFAULT_THEME, accent: '#b4741a', rowHeight: 46 },
    });

    // This is the bug that shipped: the widget used to read its own key and
    // therefore stayed indigo forever.
    const onWidget = loadPreferences('widget').theme;
    expect(onWidget.accent).toBe('#b4741a');
    expect(onWidget.rowHeight).toBe(46);
  });

  it('keeps host settings to the surface that set them', () => {
    savePreferences('desktop', {
      ...DEFAULT_PREFERENCES,
      autostart: false,
      globalHotkey: 'Ctrl+Shift+Space',
      showCompleted: true,
    });

    const widget = loadPreferences('widget');
    expect(widget.autostart).toBe(DEFAULT_PREFERENCES.autostart);
    expect(widget.globalHotkey).toBe(DEFAULT_PREFERENCES.globalHotkey);
    expect(widget.showCompleted).toBe(DEFAULT_PREFERENCES.showCompleted);
  });

  it('survives corrupt or unreadable stored JSON', () => {
    store.setItem(THEME_KEY, '{not json');
    store.setItem(keyFor('desktop'), 'null');
    expect(loadPreferences('desktop')).toEqual(DEFAULT_PREFERENCES);
  });

  it('clamps a stored theme that is out of range', () => {
    store.setItem(THEME_KEY, JSON.stringify({ rowHeight: 900, surfaceAlpha: -3, accent: 'nope' }));
    const theme = loadPreferences('desktop').theme;
    expect(theme.rowHeight).toBe(56);
    expect(theme.surfaceAlpha).toBe(0.35);
    expect(theme.accent).toBe(DEFAULT_THEME.accent);
  });
});

describe('migration from per-surface themes', () => {
  it('promotes an existing customisation rather than resetting it', () => {
    store.setItem(
      keyFor('desktop'),
      JSON.stringify({ ...DEFAULT_PREFERENCES, theme: { ...DEFAULT_THEME, accent: '#0f8b8d' } }),
    );
    expect(loadPreferences('desktop').theme.accent).toBe('#0f8b8d');
  });

  it('ignores the widget’s legacy record, which held defaults and not a choice', () => {
    // The widget's old slot was seeded with denser, translucent values that the
    // user never picked. Promoting those would re-theme every other window.
    store.setItem(
      keyFor('widget'),
      JSON.stringify({ ...DEFAULT_PREFERENCES, theme: { ...DEFAULT_THEME, rowHeight: 30 } }),
    );
    expect(loadPreferences('widget').theme.rowHeight).toBe(DEFAULT_THEME.rowHeight);
  });

  it('prefers the shared record over any legacy copy', () => {
    store.setItem(
      keyFor('desktop'),
      JSON.stringify({ theme: { ...DEFAULT_THEME, accent: '#0f8b8d' } }),
    );
    store.setItem(THEME_KEY, JSON.stringify({ ...DEFAULT_THEME, accent: '#c2415f' }));
    expect(loadPreferences('desktop').theme.accent).toBe('#c2415f');
  });
});

describe('cross-window notification', () => {
  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget());
  });

  it('follows a theme change made in another window', () => {
    const seen: string[] = [];
    const stop = watchPreferences('widget', (next) => seen.push(next.theme.accent));

    store.setItem(THEME_KEY, JSON.stringify({ ...DEFAULT_THEME, accent: '#2f8f5b' }));
    broadcast(THEME_KEY);

    expect(seen).toEqual(['#2f8f5b']);
    stop();
  });

  it('follows its own host settings but not another surface’s', () => {
    const seen: number[] = [];
    const stop = watchPreferences('widget', () => seen.push(1));

    broadcast(keyFor('desktop'));
    expect(seen).toHaveLength(0);

    broadcast(keyFor('widget'));
    expect(seen).toHaveLength(1);

    // A null key means the whole store was cleared.
    broadcast(null);
    expect(seen).toHaveLength(2);

    stop();
  });

  it('stops listening once disposed', () => {
    const seen: number[] = [];
    watchPreferences('widget', () => seen.push(1))();
    broadcast(THEME_KEY);
    expect(seen).toHaveLength(0);
  });
});

describe('widget rendering of the shared theme', () => {
  it('stays denser and more translucent than the window it follows', () => {
    const shared = { ...DEFAULT_THEME, rowHeight: 46, surfaceAlpha: 1 };
    const widget = widgetTheme(shared);
    expect(widget.rowHeight).toBeLessThan(shared.rowHeight);
    expect(widget.surfaceAlpha).toBeLessThan(shared.surfaceAlpha);
  });

  it('carries identity — accent, mode and text size — through unchanged', () => {
    const shared = { ...DEFAULT_THEME, accent: '#c2415f', mode: 'dark' as const, fontScale: 1.2 };
    const widget = widgetTheme(shared);
    expect(widget.accent).toBe('#c2415f');
    expect(widget.mode).toBe('dark');
    expect(widget.fontScale).toBe(1.2);
  });

  it('moves with the transparency control instead of ignoring it', () => {
    const opaque = widgetTheme({ ...DEFAULT_THEME, surfaceAlpha: 1 });
    const sheer = widgetTheme({ ...DEFAULT_THEME, surfaceAlpha: 0.6 });
    expect(sheer.surfaceAlpha).toBeLessThan(opaque.surfaceAlpha);
  });

  it('never renders itself invisible, however low the shared value goes', () => {
    expect(widgetTheme({ ...DEFAULT_THEME, surfaceAlpha: 0.35 }).surfaceAlpha).toBeGreaterThanOrEqual(0.35);
  });
});

describe('migration writes through', () => {
  it('promotes a legacy theme to the shared record on first read', () => {
    store.setItem(
      keyFor('desktop'),
      JSON.stringify({ theme: { ...DEFAULT_THEME, accent: '#0f8b8d' } }),
    );

    // Reading the desktop's own preferences is enough; the widget must not have
    // to wait for the user to change something before it catches up.
    loadPreferences('desktop');

    expect(JSON.parse(store.getItem(THEME_KEY)!).accent).toBe('#0f8b8d');
    expect(loadPreferences('widget').theme.accent).toBe('#0f8b8d');
  });

  it('does not write a shared record when there was nothing to promote', () => {
    loadPreferences('desktop');
    expect(store.getItem(THEME_KEY)).toBeNull();
  });
});

describe('which windows apply transparency', () => {
  it('drops it for an ordinary window, which has nothing behind it', () => {
    // Left in, a low alpha makes the settings dialog itself hard to read.
    expect(opaqueTheme({ ...DEFAULT_THEME, surfaceAlpha: 0.5 }).surfaceAlpha).toBe(1);
  });

  it('leaves the rest of the theme alone while doing so', () => {
    const shared = { ...DEFAULT_THEME, accent: '#2f8f5b', rowHeight: 44, fontScale: 1.15 };
    expect(opaqueTheme({ ...shared, surfaceAlpha: 0.5 })).toEqual({ ...shared, surfaceAlpha: 1 });
  });

  it('keeps it for the widget, the window the control exists for', () => {
    expect(widgetTheme({ ...DEFAULT_THEME, surfaceAlpha: 0.9 }).surfaceAlpha).toBeLessThan(1);
  });
});
