import { isSameVersion } from '../model/merge.js';
import type { Task } from '../model/types.js';
import type { StorageAdapter } from '../storage/types.js';
import type { OutboxEntry } from './types.js';

/** After this many consecutive rejections an entry is parked so it stops blocking the queue. */
const MAX_ATTEMPTS = 12;

/**
 * The durable queue of local changes not yet accepted by the server.
 *
 * One entry per task, holding the whole local version. Re-queuing the same task
 * overwrites its entry, so a burst of keystroke-level edits costs one push, and
 * a retry after an ambiguous failure is always safe to repeat.
 */
export class Outbox {
  private entries = new Map<string, OutboxEntry>();

  /**
   * Versions this instance has had accepted since it last persisted.
   *
   * Needed because the queue is shared. Deleting an entry from `entries` says
   * "I got this accepted"; it does not say "nobody else has queued anything
   * for this task", and the two are different once more than one window is
   * open. See `persist`.
   */
  private acknowledged = new Map<string, Task>();

  constructor(private readonly storage: StorageAdapter) {}

  async load(): Promise<void> {
    this.entries = new Map((await this.storage.loadOutbox()).map((e) => [e.taskId, e]));
  }

  /**
   * Write the queue back, merging with whatever is already there.
   *
   * In the desktop app the widget and the main window are separate JavaScript
   * contexts sharing one IndexedDB, so they share this queue. A blind
   * overwrite would let a capture made in one window silently delete a capture
   * made in the other a moment earlier — and the lost item would still be in
   * the task list, so it would look saved while never reaching the server.
   * That is the exact failure this app cannot have.
   *
   * Merging: entries on disk are the baseline, ours win for tasks we hold, and
   * an entry we had accepted is only dropped if the stored version is the one
   * we actually pushed. Anything queued elsewhere while we were in flight
   * survives.
   */
  async persist(): Promise<void> {
    const merged = new Map<string, OutboxEntry>();
    for (const entry of await this.storage.loadOutbox()) merged.set(entry.taskId, entry);
    for (const [taskId, entry] of this.entries) merged.set(taskId, entry);

    for (const [taskId, accepted] of this.acknowledged) {
      const stored = merged.get(taskId);
      if (stored && isSameVersion(stored.snapshot, accepted)) merged.delete(taskId);
    }
    this.acknowledged.clear();

    await this.storage.saveOutbox([...merged.values()]);
  }

  size(): number {
    return this.entries.size;
  }

  pendingCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.status === 'pending') n++;
    return n;
  }

  failedCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.status === 'failed') n++;
    return n;
  }

  all(): OutboxEntry[] {
    return [...this.entries.values()];
  }

  /** Oldest-first, so captures leave in the order they were made. */
  pending(limit = Number.POSITIVE_INFINITY): OutboxEntry[] {
    return this.all()
      .filter((e) => e.status === 'pending')
      .sort((a, b) => (a.queuedAt < b.queuedAt ? -1 : a.queuedAt > b.queuedAt ? 1 : 0))
      .slice(0, limit);
  }

  /**
   * Queue a task version. A later edit to the same task replaces the snapshot
   * but keeps the original queue time, so an item that has been waiting does
   * not lose its place by being edited again.
   */
  enqueue(task: Task, queuedAt: string): void {
    const existing = this.entries.get(task.id);
    this.entries.set(task.id, {
      taskId: task.id,
      snapshot: task,
      queuedAt: existing?.queuedAt ?? queuedAt,
      attempts: 0,
      // A fresh edit is a fresh chance: revive a parked entry rather than
      // stranding the user's newest change behind an old failure.
      status: 'pending',
      lastError: null,
    });
  }

  /**
   * Remove entries the server accepted — but only if the user has not edited
   * that task since it was sent. Otherwise the newer edit would be dropped
   * along with the acknowledgement.
   */
  ack(sent: readonly Task[]): void {
    for (const task of sent) {
      // Recorded whether or not we still hold the entry, so the next persist
      // can tell "accepted" apart from "queued by another window".
      this.acknowledged.set(task.id, task);
      const entry = this.entries.get(task.id);
      if (entry && isSameVersion(entry.snapshot, task)) this.entries.delete(task.id);
    }
  }

  /** Record a retryable failure against the entries in a failed batch. */
  recordFailure(sent: readonly Task[], message: string): void {
    for (const task of sent) {
      const entry = this.entries.get(task.id);
      if (!entry) continue;
      const attempts = entry.attempts + 1;
      entry.attempts = attempts;
      entry.lastError = message;
      if (attempts >= MAX_ATTEMPTS) entry.status = 'failed';
    }
  }

  /**
   * Park entries the server refused outright. They stay in the queue so the
   * data is never lost and the UI can surface them, but they no longer hold up
   * everything queued behind them.
   */
  markFailed(sent: readonly Task[], message: string): void {
    for (const task of sent) {
      const entry = this.entries.get(task.id);
      if (!entry) continue;
      entry.status = 'failed';
      entry.lastError = message;
    }
  }

  /** Put parked entries back in the queue — used when the user asks to retry. */
  retryFailed(): void {
    for (const entry of this.entries.values()) {
      if (entry.status === 'failed') {
        entry.status = 'pending';
        entry.attempts = 0;
        entry.lastError = null;
      }
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
