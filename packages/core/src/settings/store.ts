import type { StorageAdapter } from '../storage/types.js';
import {
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  normalizeSetting,
  normalizeSettings,
  sameValue,
  type SettingKey,
  type SyncedSettings,
} from './schema.js';

/** One setting as stored and synced: the value and when it was chosen. */
export interface StampedValue {
  v: unknown;
  t: string;
}

export type StampedSettings = Partial<Record<string, StampedValue>>;

/** What the settings store needs from a backend. */
export interface SettingsRemote {
  getUserId(): string | null;
  /** Everything the server holds for this account. */
  fetchSettings(): Promise<StampedSettings>;
  /**
   * Merge these into the server's copy, newest stamp winning per key, and
   * return the whole result — so a device that lost a comparison learns the
   * winner on the same round trip, as with tasks.
   */
  putSettings(patch: StampedSettings): Promise<StampedSettings>;
  /** Live updates. Returns an unsubscribe function. */
  subscribeSettings(onChange: (all: StampedSettings) => void): () => void;
}

/** What is kept on disk: the stamped values, and which of them the server has not seen. */
export interface PersistedSettings {
  stamped: StampedSettings;
  dirty: string[];
}

export const META_SETTINGS = 'settings';

export interface SettingsStoreOptions {
  storage: StorageAdapter;
  remote: SettingsRemote | null;
  /** ISO timestamp source; injectable for tests. */
  now?: () => string;
  /** BroadcastChannel name for other windows on this machine; null disables it. */
  channelName?: string | null;
}

/**
 * Account-level settings, merged per key by last write.
 *
 * The same idea as tasks, at a much smaller scale. Each setting carries the
 * time it was chosen, so changing the font on the phone and the corners on the
 * desktop while one of them is offline keeps both — a whole-record overwrite
 * would keep whichever device happened to sync last.
 *
 * A change is applied and persisted locally first and marked dirty until the
 * server has it, so it survives a closed window or a dead network the same way
 * a capture does. Several contexts on one machine share the persisted copy —
 * the extension's popup and worker, the desktop's windows — so reading and
 * writing it merges rather than overwrites, by the same rule.
 */
export class SettingsStore {
  private stamped: StampedSettings = {};
  private dirty = new Set<string>();
  private snapshot: SyncedSettings = DEFAULT_SETTINGS;
  private readonly listeners = new Set<() => void>();
  private readonly now: () => string;
  private readonly channelName: string | null;
  private channel: BroadcastChannel | null = null;
  private unsubscribeRemote: (() => void) | null = null;
  private started = false;
  private syncing: Promise<void> | null = null;
  private resyncRequested = false;

  constructor(private readonly options: SettingsStoreOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.channelName =
      options.channelName === undefined ? 'recall-settings' : options.channelName;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.reload();

    if (this.channelName && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(this.channelName);
      this.channel.addEventListener('message', () => void this.reload());
    }
    this.unsubscribeRemote =
      this.options.remote?.subscribeSettings((all) => void this.integrate(all)) ?? null;

    void this.sync();
  }

  stop(): void {
    this.started = false;
    this.channel?.close();
    this.channel = null;
    this.unsubscribeRemote?.();
    this.unsubscribeRemote = null;
  }

  get(): SyncedSettings {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** True while a change made here has not reached the server. */
  hasUnsyncedChanges(): boolean {
    return this.dirty.size > 0;
  }

  /** Change some settings. Applied at once; delivered when it can be. */
  async update(patch: Partial<SyncedSettings>): Promise<void> {
    const at = this.now();
    let changed = false;
    for (const key of Object.keys(patch) as SettingKey[]) {
      if (!SETTING_KEYS.includes(key)) continue;
      const value = normalizeSetting(key, patch[key]);
      if (sameValue(value, this.snapshot[key])) continue;
      this.stamped[key] = { v: value, t: at };
      this.dirty.add(key);
      changed = true;
    }
    if (!changed) return;

    this.recompute();
    this.notify();
    await this.persist();
    this.channel?.postMessage({ at });
    void this.sync();
  }

  /**
   * Push what changed here, then take the server's view.
   *
   * Safe to call at any time and from anywhere; overlapping calls collapse
   * into one, with a second pass if anything changed while the first ran.
   */
  async sync(): Promise<void> {
    if (this.syncing) {
      this.resyncRequested = true;
      return this.syncing;
    }
    this.syncing = (async () => {
      do {
        this.resyncRequested = false;
        await this.syncOnce();
      } while (this.resyncRequested);
    })().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  /** Forget everything held for the account — for sign-out. */
  async reset(): Promise<void> {
    this.stamped = {};
    this.dirty.clear();
    this.recompute();
    this.notify();
    const empty: PersistedSettings = { stamped: {}, dirty: [] };
    await this.options.storage.setMeta(META_SETTINGS, empty);
    this.channel?.postMessage({ at: this.now() });
  }

  /* ------------------------------------------------------------- internals */

  private async syncOnce(): Promise<void> {
    const remote = this.options.remote;
    if (!this.started || !remote?.getUserId()) return;

    try {
      if (this.dirty.size === 0) {
        await this.integrate(await remote.fetchSettings());
        return;
      }

      const sent: StampedSettings = {};
      for (const key of this.dirty) {
        const entry = this.stamped[key];
        if (entry) sent[key] = entry;
      }
      const result = await remote.putSettings(sent);

      // The server may have clamped a stamp from a fast clock, or kept a newer
      // value from elsewhere. Either way its answer is the truth for every key
      // we sent, as long as we have not changed that key again since.
      for (const [key, mine] of Object.entries(sent)) {
        const theirs = result[key];
        const current = this.stamped[key];
        if (!mine || !theirs || current?.t !== mine.t) continue;
        if (sameValue(theirs.v, mine.v) || theirs.t >= mine.t) {
          this.stamped[key] = theirs;
          this.dirty.delete(key);
        }
      }
      await this.integrate(result, true);
    } catch {
      // Offline, signed out, or the settings table not created yet. The change
      // is kept and dirty, and the next sync — any sync — tries again.
    }
  }

  /** Fold in a complete copy from the server or a live update. */
  private async integrate(incoming: StampedSettings, alwaysPersist = false): Promise<void> {
    let changed = false;
    for (const [key, theirs] of Object.entries(incoming)) {
      if (!theirs || !SETTING_KEYS.includes(key as SettingKey)) continue;
      const mine = this.stamped[key];
      if (mine && this.dirty.has(key) && mine.t >= theirs.t) continue;
      if (mine && mine.t > theirs.t) continue;
      if (mine && mine.t === theirs.t && sameValue(mine.v, theirs.v)) continue;
      this.stamped[key] = theirs;
      this.dirty.delete(key);
      changed = true;
    }
    if (changed) {
      this.recompute();
      this.notify();
    }
    if (changed || alwaysPersist) {
      await this.persist();
      this.channel?.postMessage({ at: this.now() });
    }
  }

  /** Pick up what another window on this machine wrote. */
  private async reload(): Promise<void> {
    try {
      const stored = await this.options.storage.getMeta<PersistedSettings>(META_SETTINGS);
      const merged = combine({ stamped: this.stamped, dirty: [...this.dirty] }, stored);
      this.stamped = merged.stamped;
      this.dirty = new Set(merged.dirty);
      this.recompute();
      this.notify();
    } catch {
      /* Defaults are a fine answer when storage is unreadable. */
    }
  }

  /** Write back, merging with whatever another window wrote meanwhile. */
  private async persist(): Promise<void> {
    try {
      const stored = await this.options.storage.getMeta<PersistedSettings>(META_SETTINGS);
      const merged = combine(stored, { stamped: this.stamped, dirty: [...this.dirty] });
      await this.options.storage.setMeta(META_SETTINGS, merged);
    } catch {
      /* Still live in memory for this session. */
    }
  }

  private recompute(): void {
    const values: Partial<Record<string, unknown>> = {};
    for (const [key, entry] of Object.entries(this.stamped)) if (entry) values[key] = entry.v;
    this.snapshot = normalizeSettings(values);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/**
 * Merge two persisted copies, newest stamp winning per key.
 *
 * A key is still dirty if the winning side had it dirty — except when both
 * sides hold the same write and one of them has already had it accepted.
 */
export function combine(
  a: PersistedSettings | null | undefined,
  b: PersistedSettings | null | undefined,
): PersistedSettings {
  const left = a ?? { stamped: {}, dirty: [] };
  const right = b ?? { stamped: {}, dirty: [] };
  const leftDirty = new Set(left.dirty);
  const rightDirty = new Set(right.dirty);
  const stamped: StampedSettings = {};
  const dirty: string[] = [];

  const keys = new Set([...Object.keys(left.stamped), ...Object.keys(right.stamped)]);
  for (const key of keys) {
    const l = left.stamped[key];
    const r = right.stamped[key];
    let winner: StampedValue;
    let isDirty: boolean;
    if (l && (!r || l.t > r.t)) {
      winner = l;
      isDirty = leftDirty.has(key);
    } else if (r && (!l || r.t > l.t)) {
      winner = r;
      isDirty = rightDirty.has(key);
    } else if (l && r) {
      winner = r;
      isDirty = leftDirty.has(key) && rightDirty.has(key);
    } else {
      continue;
    }
    stamped[key] = winner;
    if (isDirty) dirty.push(key);
  }
  return { stamped, dirty };
}
