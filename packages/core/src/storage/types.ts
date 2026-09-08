import type { Task } from '../model/types.js';
import type { OutboxEntry } from '../sync/types.js';

/**
 * Durable local storage.
 *
 * Every surface keeps a complete local mirror, so the app is fully usable with
 * no network and a crash cannot lose a capture. The three implementations
 * (IndexedDB, chrome.storage, in-memory) exist because the three hosts offer
 * different primitives — the engine above this interface never knows which.
 */
export interface StorageAdapter {
  readonly name: string;

  loadTasks(): Promise<Task[]>;
  saveTasks(tasks: readonly Task[]): Promise<void>;
  deleteTasks(ids: readonly string[]): Promise<void>;

  loadOutbox(): Promise<OutboxEntry[]>;
  /** Replaces the queue wholesale — the queue is small and atomicity matters more than write volume. */
  saveOutbox(entries: readonly OutboxEntry[]): Promise<void>;

  getMeta<T>(key: string): Promise<T | null>;
  setMeta(key: string, value: unknown): Promise<void>;

  /**
   * Notify when another context (a second window, the extension's service
   * worker) writes to the same store. Optional: hosts without a cross-context
   * store return undefined and rely on BroadcastChannel instead.
   */
  watch?(onExternalChange: () => void): () => void;

  close?(): void;
}

export const META_CURSOR = 'sync.cursor';
export const META_LAST_SYNCED = 'sync.lastSyncedAt';
export const META_DEVICE_ID = 'device.id';
