import type { Task } from '../model/types.js';
import type { OutboxEntry } from '../sync/types.js';
import type { StorageAdapter } from './types.js';

/**
 * In-memory storage. Used by the convergence tests and as a last-resort
 * fallback when a host denies persistent storage — the app still works for the
 * session rather than refusing to start.
 */
export class MemoryStorage implements StorageAdapter {
  readonly name = 'memory';
  private tasks = new Map<string, Task>();
  private outbox: OutboxEntry[] = [];
  private meta = new Map<string, unknown>();

  async loadTasks(): Promise<Task[]> {
    return [...this.tasks.values()].map(clone);
  }

  async saveTasks(tasks: readonly Task[]): Promise<void> {
    for (const t of tasks) this.tasks.set(t.id, clone(t));
  }

  async deleteTasks(ids: readonly string[]): Promise<void> {
    for (const id of ids) this.tasks.delete(id);
  }

  async loadOutbox(): Promise<OutboxEntry[]> {
    return this.outbox.map(clone);
  }

  async saveOutbox(entries: readonly OutboxEntry[]): Promise<void> {
    this.outbox = entries.map(clone);
  }

  async getMeta<T>(key: string): Promise<T | null> {
    return (this.meta.get(key) as T | undefined) ?? null;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    this.meta.set(key, value);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
