import { DEFAULT_THEME, normalizeTheme, type ThemeSettings } from '@recall/ui';

/**
 * Preferences, split into an appearance half and a host half.
 *
 * Kept in `localStorage` rather than the sync engine's store for one specific
 * reason: the theme has to be applied before the first paint, and an async read
 * would show a flash of the wrong colours every time the widget appears.
 *
 * The split matters. Appearance is one shared record for the whole device, so
 * changing the accent in the desktop app recolours the widget without either
 * window restarting — the widget has no settings screen of its own, so a theme
 * stored per-surface would be a theme nobody could ever change. Host settings
 * (autostart, always-on-top, the hotkey, whether completed tasks are listed)
 * genuinely belong to one window and stay per-surface.
 *
 * Surfaces that want to look different still can: see `widgetTheme`, which
 * renders the shared theme denser and more translucent rather than storing a
 * second copy of it.
 */
export interface Preferences {
  theme: ThemeSettings;
  /** Whether completed tasks stay visible under the open ones. */
  showCompleted: boolean;
  /** Desktop only; read by the Tauri shell. */
  alwaysOnTop: boolean;
  autostart: boolean;
  /**
   * Preferred quick-capture shortcut. The shell may end up bound to a
   * different one when this combination is already owned by another
   * application, so treat the shell's reported status as authoritative.
   */
  globalHotkey: string;
}

/** Everything in `Preferences` except the shared theme. */
type HostPreferences = Omit<Preferences, 'theme'>;

export const DEFAULT_PREFERENCES: Preferences = {
  theme: DEFAULT_THEME,
  showCompleted: false,
  alwaysOnTop: true,
  autostart: true,
  globalHotkey: 'CommandOrControl+Alt+Space',
};

const STORAGE_KEY = 'recall.preferences';

/** One appearance record for every window on the machine. */
export const THEME_KEY = `${STORAGE_KEY}.theme`;

/**
 * The appearance record on disk: the theme plus the version of the defaults it
 * was saved against. Every save writes the whole theme, chosen or not, so
 * without the version a later change to a default could not tell "never
 * touched" from "picked exactly the old default" — and would be pinned out of
 * every existing install by the very record it was meant to change.
 */
interface StoredTheme extends Partial<ThemeSettings> {
  version?: number;
}

export const THEME_VERSION = 2;

/** The row height every record before v2 carried, whether or not it was a choice. */
const ROW_HEIGHT_BEFORE_V2 = 34;

/**
 * Bring a stored record up to the current defaults.
 *
 * v2 made every row denser. A v1 record still holding the old default row
 * height is overwhelmingly one that was never adjusted, so that field is
 * dropped and the new default applies; anything else in it was a choice and
 * stays. A record already at v2 is returned as it is — someone who later sets
 * the slider to the old value gets exactly that.
 */
function migrateTheme(stored: StoredTheme | null | undefined): Partial<ThemeSettings> | null {
  if (!stored) return null;
  if ((stored.version ?? 1) >= THEME_VERSION) return stored;
  const { rowHeight, ...rest } = stored;
  return rowHeight === ROW_HEIGHT_BEFORE_V2 ? rest : stored;
}

function storedTheme(theme: ThemeSettings): StoredTheme {
  return { ...normalizeTheme(theme), version: THEME_VERSION };
}

/** Host settings get a slot per surface — the widget's autostart is not the web app's. */
export function keyFor(surface: string): string {
  return `${STORAGE_KEY}.${surface}`;
}

function readJson<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Partial<T>) : null;
  } catch {
    // Private mode, blocked storage, or corrupt JSON. Defaults are a fine
    // answer here — preferences are not data worth failing over.
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Non-fatal: the session keeps the setting, it just will not survive a restart. */
  }
}

export function loadPreferences(surface: string): Preferences {
  const host = readJson<Preferences>(keyFor(surface));
  const stored = readJson<StoredTheme>(THEME_KEY);

  // Records written before the theme was shared still carry one inline. Honour
  // it so an existing customisation is not silently reset — except the
  // widget's, which was never a choice but the denser defaults it used to be
  // seeded with, and would now re-theme every other window.
  const legacy =
    surface === 'widget' ? undefined : (host?.theme as StoredTheme | undefined);

  const theme = normalizeTheme({
    ...DEFAULT_THEME,
    ...migrateTheme(legacy),
    ...migrateTheme(stored),
  });

  // Promote or upgrade it for real, once. Returning the value without writing
  // it would leave the other windows on defaults until the user happened to
  // change a setting — and the pre-paint bootstraps, which read the record
  // without migrating it, would flash the old layout on every open.
  const outdated = stored ? (stored.version ?? 1) < THEME_VERSION : Boolean(legacy);
  if (outdated) writeJson(THEME_KEY, storedTheme(theme));

  return {
    ...DEFAULT_PREFERENCES,
    ...(host as Partial<HostPreferences> | null),
    theme,
  };
}

export function savePreferences(surface: string, preferences: Preferences): void {
  const { theme, ...host } = preferences;
  writeJson(THEME_KEY, storedTheme(theme));
  writeJson(keyFor(surface), host satisfies HostPreferences);
}

/**
 * Notify other windows on this machine.
 *
 * Two keys matter to any given surface: its own host settings, and the shared
 * appearance record that every window follows. A `null` key means the whole
 * store was cleared, which affects both.
 */
export function watchPreferences(
  surface: string,
  onChange: (next: Preferences) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const watched = new Set([keyFor(surface), THEME_KEY]);
  const handler = (event: StorageEvent) => {
    if (event.key === null || watched.has(event.key)) onChange(loadPreferences(surface));
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
