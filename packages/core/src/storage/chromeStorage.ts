import type { Task } from '../model/types.js';
import type { OutboxEntry } from '../sync/types.js';
import type { StorageAdapter } from './types.js';

const TASK_PREFIX = 't:';
const META_PREFIX = 'm:';
const OUTBOX_KEY = 'outbox';

interface ChromeStorageArea {
  get(keys: string[] | string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[] | string): Promise<void>;
}

interface ChromeLike {
  storage: {
    local: ChromeStorageArea;
    onChanged: {
      addListener(cb: (changes: Record<string, unknown>, area: string) => void): void;
      removeListener(cb: (changes: Record<string, unknown>, area: string) => void): void;
    };
  };
}

declare const chrome: ChromeLike | undefined;

/**
 * chrome.storage.local for the extension.
 *
 * Chosen over IndexedDB because the popup and the MV3 service worker are
 * separate contexts that both need the cache, and `storage.onChanged` gives
 * cross-context change notification for free — so a task added from the omnibox
 * shows up in an already-open popup without any message passing.
 *
 * Tasks are stored under one key each rather than as a single blob, so the
 * service worker and the popup writing at the same time cannot clobber each
 * other with a stale read-modify-write.
 */
export class ChromeStorage implements StorageAdapter {
  readonly name = 'chrome.storage';

  private get area(): ChromeStorageArea {
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) {
      throw new Error('chrome.storage.local is unavailable in this context');
    }
    return chrome.storage.local;
  }

  async loadTasks(): Promise<Task[]> {
    const all = await this.area.get(null);
    const tasks: Task[] = [];
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith(TASK_PREFIX) && value) tasks.push(value as Task);
    }
    return tasks;
  }

  async saveTasks(tasks: readonly Task[]): Promise<void> {
    if (tasks.length === 0) return;
    const items: Record<string, unknown> = {};
    for (const t of tasks) items[TASK_PREFIX + t.id] = t;
    await this.area.set(items);
  }

  async deleteTasks(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.area.remove(ids.map((id) => TASK_PREFIX + id));
  }

  async loadOutbox(): Promise<OutboxEntry[]> {
    const result = await this.area.get(OUTBOX_KEY);
    return (result[OUTBOX_KEY] as OutboxEntry[] | undefined) ?? [];
  }

  async saveOutbox(entries: readonly OutboxEntry[]): Promise<void> {
    await this.area.set({ [OUTBOX_KEY]: entries });
  }

  async getMeta<T>(key: string): Promise<T | null> {
    const full = META_PREFIX + key;
    const result = await this.area.get(full);
    return (result[full] as T | undefined) ?? null;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.area.set({ [META_PREFIX + key]: value });
  }

  watch(onExternalChange: () => void): () => void {
    if (typeof chrome === 'undefined' || !chrome?.storage?.onChanged) return () => {};
    const listener = (changes: Record<string, unknown>, area: string) => {
      if (area !== 'local') return;
      const relevant = Object.keys(changes).some(
        (k) => k.startsWith(TASK_PREFIX) || k === OUTBOX_KEY,
      );
      if (relevant) onExternalChange();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome?.storage.onChanged.removeListener(listener);
  }
}

export function chromeStorageAvailable(): boolean {
  return typeof chrome !== 'undefined' && !!chrome?.storage?.local;
}
