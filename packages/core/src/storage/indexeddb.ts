import { openDB, type IDBPDatabase } from 'idb';
import type { Task } from '../model/types.js';
import type { OutboxEntry } from '../sync/types.js';
import type { StorageAdapter } from './types.js';

const DB_NAME = 'recall';
const DB_VERSION = 1;
const TASKS = 'tasks';
const OUTBOX = 'outbox';
const META = 'meta';

interface Schema {
  tasks: Task;
  outbox: OutboxEntry;
  meta: unknown;
}

/**
 * IndexedDB-backed storage for the web app and the Tauri windows.
 *
 * Writes go through one transaction per batch, so a crash mid-save leaves the
 * store consistent rather than half-updated.
 */
export class IndexedDbStorage implements StorageAdapter {
  readonly name = 'indexeddb';
  private dbPromise: Promise<IDBPDatabase<any>> | null = null;
  private channel: BroadcastChannel | null = null;

  constructor(private readonly dbName: string = DB_NAME) {}

  private db(): Promise<IDBPDatabase<any>> {
    this.dbPromise ??= openDB<Schema>(this.dbName, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(TASKS)) db.createObjectStore(TASKS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'taskId' });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      },
    });
    return this.dbPromise;
  }

  async loadTasks(): Promise<Task[]> {
    return (await this.db()).getAll(TASKS) as Promise<Task[]>;
  }

  async saveTasks(tasks: readonly Task[]): Promise<void> {
    if (tasks.length === 0) return;
    const db = await this.db();
    const tx = db.transaction(TASKS, 'readwrite');
    await Promise.all(tasks.map((t) => tx.store.put(t)));
    await tx.done;
  }

  async deleteTasks(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await this.db();
    const tx = db.transaction(TASKS, 'readwrite');
    await Promise.all(ids.map((id) => tx.store.delete(id)));
    await tx.done;
  }

  async loadOutbox(): Promise<OutboxEntry[]> {
    return (await this.db()).getAll(OUTBOX) as Promise<OutboxEntry[]>;
  }

  async saveOutbox(entries: readonly OutboxEntry[]): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(OUTBOX, 'readwrite');
    await tx.store.clear();
    await Promise.all(entries.map((e) => tx.store.put(e)));
    await tx.done;
  }

  async getMeta<T>(key: string): Promise<T | null> {
    const value = await (await this.db()).get(META, key);
    return (value as T | undefined) ?? null;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await (await this.db()).put(META, value, key);
  }

  /**
   * IndexedDB has no change notification across windows, so peer windows are
   * told over a BroadcastChannel instead. This is what makes an edit in the
   * widget appear in the main window instantly, without a server round trip.
   */
  watch(onExternalChange: () => void): () => void {
    if (typeof BroadcastChannel === 'undefined') return () => {};
    this.channel = new BroadcastChannel(`${this.dbName}-storage`);
    const handler = () => onExternalChange();
    this.channel.addEventListener('message', handler);
    return () => {
      this.channel?.removeEventListener('message', handler);
      this.channel?.close();
      this.channel = null;
    };
  }

  notifyPeers(): void {
    this.channel?.postMessage({ t: Date.now() });
  }

  close(): void {
    this.channel?.close();
    this.channel = null;
    void this.dbPromise?.then((db) => db.close());
    this.dbPromise = null;
  }
}

/** IndexedDB is unavailable in private modes and some embedded WebViews. */
export function indexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}
