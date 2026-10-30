/**
 * Settings that follow the account rather than the device.
 *
 * Two kinds live here. Behaviour — where new tasks go, whether finished ones
 * are cleared overnight — has to agree everywhere, or a task captured on the
 * phone lands somewhere different from one captured on the desktop. And the
 * look of the list and the widgets, which the user asked to set once.
 *
 * Every value is validated on the way in, wherever it came from: the server,
 * another window, or an old record. A corrupt colour written straight into a
 * style would at best be ignored and at worst blank the list.
 *
 * `null` means "this surface's own default", which is how a setting nobody has
 * touched keeps each surface looking exactly as it did before it existed.
 */

export type WidgetCorners = 'none' | 'small' | 'medium' | 'large';
export type TaskTypeface = 'system' | 'serif' | 'mono' | 'condensed';
export type TaskWeight = 'regular' | 'medium' | 'bold';

export interface TaskMargins {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SyncedSettings {
  /** New captures go to the end of the list instead of the top. */
  addToBottom: boolean;
  /** At local midnight, completed tasks are deleted (recoverably). */
  autoClearCompleted: boolean;

  /** `#rrggbb`, or null for the theme's own surface colour. */
  widgetBackground: string | null;
  /** 0–1. How much of the widget's background is painted. */
  widgetOpacity: number;
  /** `#rrggbb`, `'none'`, or null for the surface's own default border. */
  widgetBorder: string | null;
  widgetCorners: WidgetCorners | null;

  /** Px on the web, sp on Android; null follows the interface text size. */
  taskFontSize: number | null;
  taskColor: string | null;
  taskCompletedColor: string | null;
  taskTypeface: TaskTypeface;
  taskWeight: TaskWeight;
  taskItalic: boolean;
  /** Px (dp on Android) of space around each task row. */
  taskMargins: TaskMargins;
}

export type SettingKey = keyof SyncedSettings;

/**
 * The widget's background opacity before anyone chose one. Both widgets were
 * already painted at this: the desktop one as 0.82 of an opaque surface, the
 * phone one as `#D1` alpha. Making it the default keeps both unchanged.
 */
export const DEFAULT_WIDGET_OPACITY = 0.82;

export const DEFAULT_SETTINGS: SyncedSettings = {
  addToBottom: false,
  autoClearCompleted: false,
  widgetBackground: null,
  widgetOpacity: DEFAULT_WIDGET_OPACITY,
  widgetBorder: null,
  widgetCorners: null,
  taskFontSize: null,
  taskColor: null,
  taskCompletedColor: null,
  taskTypeface: 'system',
  taskWeight: 'regular',
  taskItalic: false,
  taskMargins: { left: 0, top: 0, right: 0, bottom: 0 },
};

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[];

export const SETTING_LIMITS = {
  taskFontSize: { min: 10, max: 24 },
  taskMargin: { min: 0, max: 24 },
  widgetOpacity: { min: 0, max: 1 },
} as const;

/** Corner radius for each choice, in px on the desktop and dp on Android. */
export const CORNER_RADIUS: Record<WidgetCorners, number> = {
  none: 0,
  small: 6,
  medium: 12,
  large: 20,
};

const HEX = /^#[0-9a-f]{6}$/i;

const colour = (value: unknown): string | null =>
  typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : null;

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

const clamped = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Validate one value, falling back to the default rather than throwing. */
export function normalizeSetting<K extends SettingKey>(key: K, value: unknown): SyncedSettings[K] {
  const fallback = DEFAULT_SETTINGS[key];
  switch (key) {
    case 'addToBottom':
    case 'autoClearCompleted':
    case 'taskItalic':
      return (typeof value === 'boolean' ? value : fallback) as SyncedSettings[K];
    case 'widgetBackground':
    case 'taskColor':
    case 'taskCompletedColor':
      return colour(value) as SyncedSettings[K];
    case 'widgetBorder':
      return (value === 'none' ? 'none' : colour(value)) as SyncedSettings[K];
    case 'widgetOpacity':
      return clamped(value, 0, 1, DEFAULT_WIDGET_OPACITY) as SyncedSettings[K];
    case 'widgetCorners':
      return (value === null || value === undefined
        ? null
        : oneOf(value, ['none', 'small', 'medium', 'large'] as const, 'medium')) as SyncedSettings[K];
    case 'taskFontSize': {
      if (value === null || value === undefined) return null as SyncedSettings[K];
      const { min, max } = SETTING_LIMITS.taskFontSize;
      return Math.round(clamped(value, min, max, 14)) as SyncedSettings[K];
    }
    case 'taskTypeface':
      return oneOf(value, ['system', 'serif', 'mono', 'condensed'] as const, 'system') as SyncedSettings[K];
    case 'taskWeight':
      return oneOf(value, ['regular', 'medium', 'bold'] as const, 'regular') as SyncedSettings[K];
    case 'taskMargins': {
      const raw = (value && typeof value === 'object' ? value : {}) as Partial<TaskMargins>;
      const { min, max } = SETTING_LIMITS.taskMargin;
      const side = (n: unknown) => Math.round(clamped(n, min, max, 0));
      return {
        left: side(raw.left),
        top: side(raw.top),
        right: side(raw.right),
        bottom: side(raw.bottom),
      } as SyncedSettings[K];
    }
    default:
      return fallback;
  }
}

export function normalizeSettings(raw: Partial<Record<string, unknown>> | null | undefined): SyncedSettings {
  const result = { ...DEFAULT_SETTINGS };
  if (!raw) return result;
  for (const key of SETTING_KEYS) {
    if (key in raw) (result as Record<SettingKey, unknown>)[key] = normalizeSetting(key, raw[key]);
  }
  return result;
}

/** Structural equality for setting values, which are JSON. */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
