/**
 * The runtime half of the design system.
 *
 * `tokens.css` holds the defaults; this module lets the settings screen
 * override a small, deliberately chosen subset of them at runtime. Keeping that
 * subset small is the point — every knob exposed here is one the user asked
 * for, and adding more is a decision, not a reflex.
 */

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeSettings {
  mode: ThemeMode;
  /** Hex accent colour. Everything accent-derived is computed from it. */
  accent: string;
  /** 0.4–1. Below 1 the surface lets the desktop through; the widget defaults lower. */
  surfaceAlpha: number;
  /** Task row height in pixels. */
  rowHeight: number;
  /** Multiplies every type size. */
  fontScale: number;
}

export const ACCENT_PRESETS = [
  { name: 'Indigo', value: '#5b5bd6' },
  { name: 'Teal', value: '#0f8b8d' },
  { name: 'Amber', value: '#b4741a' },
  { name: 'Rose', value: '#c2415f' },
  { name: 'Slate', value: '#4a5568' },
  { name: 'Green', value: '#2f8f5b' },
] as const;

export const DEFAULT_THEME: ThemeSettings = {
  mode: 'system',
  accent: '#5b5bd6',
  surfaceAlpha: 1,
  rowHeight: 28,
  fontScale: 1,
};

/**
 * How the widget renders the shared theme.
 *
 * The widget sits permanently over the desktop, so it wants to be denser and
 * to let the wallpaper through. It is still the same product though, so accent,
 * mode and text size come from the one shared theme rather than a second copy
 * that the settings screen has no way to reach — the widget has no settings UI
 * of its own, so anything stored only for the widget can never be changed.
 *
 * These are offsets rather than replacements, which is what makes the
 * transparency control meaningful: raise it and the widget goes further than
 * the rest, because it is the only window with a desktop behind it.
 */
/**
 * How an ordinary window renders the shared theme.
 *
 * Transparency is dropped. Only the widget and the quick-capture bar are
 * genuinely transparent windows with the desktop showing through; in the main
 * window, the web app and the extension popup there is nothing behind the
 * surface but the app's own background, so a translucent panel is legibility
 * spent for no effect — at high settings the settings dialog itself becomes
 * hard to read. The control still works, it just moves the window it was
 * meant for.
 */
export function opaqueTheme(shared: ThemeSettings): ThemeSettings {
  return normalizeTheme({ ...shared, surfaceAlpha: 1 });
}

export const WIDGET_ALPHA_FACTOR = 0.82;
export const WIDGET_ROW_HEIGHT_DELTA = -3;

export function widgetTheme(shared: ThemeSettings): ThemeSettings {
  const base = normalizeTheme(shared);
  return normalizeTheme({
    ...base,
    surfaceAlpha: base.surfaceAlpha * WIDGET_ALPHA_FACTOR,
    rowHeight: base.rowHeight + WIDGET_ROW_HEIGHT_DELTA,
  });
}

/**
 * The range each runtime knob accepts. Exported so the settings sliders and the
 * pre-paint bootstraps clamp to the same numbers as the normaliser; a slider
 * that reaches a value the normaliser rejects would snap back on every save.
 */
export const THEME_LIMITS = {
  surfaceAlpha: { min: 0.35, max: 1 },
  /*
   * A row is the text line plus what surrounds it: 13.5px type at 1.3 leading
   * needs about 18px, so the floor leaves the text a couple of pixels of air
   * and the ceiling is roomy without being a list of buttons.
   */
  rowHeight: { min: 22, max: 56 },
  fontScale: { min: 0.85, max: 1.4 },
} as const;

const clamp = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

export function normalizeTheme(partial: Partial<ThemeSettings> | null | undefined): ThemeSettings {
  const merged = { ...DEFAULT_THEME, ...(partial ?? {}) };
  return {
    mode: (['light', 'dark', 'system'] as const).includes(merged.mode) ? merged.mode : 'system',
    accent: /^#[0-9a-f]{6}$/i.test(merged.accent) ? merged.accent : DEFAULT_THEME.accent,
    surfaceAlpha: clamp(merged.surfaceAlpha, THEME_LIMITS.surfaceAlpha.min, THEME_LIMITS.surfaceAlpha.max),
    rowHeight: Math.round(clamp(merged.rowHeight, THEME_LIMITS.rowHeight.min, THEME_LIMITS.rowHeight.max)),
    fontScale: clamp(merged.fontScale, THEME_LIMITS.fontScale.min, THEME_LIMITS.fontScale.max),
  };
}

/**
 * Write the theme onto an element as inline custom properties.
 *
 * Inline properties beat the stylesheet's `:root` defaults without needing a
 * second stylesheet or a class-name matrix, so a change applies instantly and
 * everything downstream — including the parts of the UI that never heard of the
 * settings screen — picks it up.
 */
export function applyTheme(root: HTMLElement, settings: ThemeSettings): void {
  const theme = normalizeTheme(settings);

  root.dataset.theme = theme.mode;
  if (theme.mode === 'system') {
    root.dataset.systemDark = String(prefersDark());
  } else {
    delete root.dataset.systemDark;
  }

  const style = root.style;
  style.setProperty('--rc-accent', theme.accent);
  style.setProperty('--rc-accent-strong', shade(theme.accent, theme.mode === 'dark' ? 0.18 : -0.16));
  style.setProperty('--rc-accent-contrast', readableOn(theme.accent));
  style.setProperty('--rc-surface-alpha', String(theme.surfaceAlpha));
  style.setProperty('--rc-row-height', `${theme.rowHeight}px`);
  style.setProperty('--rc-font-scale', String(theme.fontScale));
}

export function prefersDark(): boolean {
  return (
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/**
 * Re-evaluate on OS theme changes so "system" keeps meaning system after the
 * window has been open for a week.
 */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const query = matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** Lighten (positive) or darken (negative) a hex colour. */
export function shade(hex: string, amount: number): string {
  const { r, g, b } = parseHex(hex);
  const mix = (channel: number) =>
    Math.round(amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount));
  return toHex(mix(r), mix(g), mix(b));
}

/** Pick black or white text for a background, by perceived luminance. */
export function readableOn(hex: string): string {
  const { r, g, b } = parseHex(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#14141a' : '#ffffff';
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  return {
    r: Number.parseInt(full.slice(0, 2), 16) || 0,
    g: Number.parseInt(full.slice(2, 4), 16) || 0,
    b: Number.parseInt(full.slice(4, 6), 16) || 0,
  };
}

function toHex(r: number, g: number, b: number): string {
  const part = (v: number) => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}
