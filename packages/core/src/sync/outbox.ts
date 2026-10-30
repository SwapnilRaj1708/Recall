import { isSameVersion, mergeTask } from '../model/merge.js';
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

  /**
   * Entries queued by this instance that the server has not accepted yet.
   *
   * The queue on disk is shared — the extension's popup and worker, and the
   * desktop's three windows, all read and rewrite it — and neither store makes
   * that read-modify-write atomic. Two things followed from that, and both lost
   * a capture outright: the task stayed in the list looking saved, and never
   * reached the server.
   *
   * - A reload replacing memory with the disk before this instance's own write
   *   had landed. In the extension this happened on every capture, because
   *   Chrome delivers a storage change event to the context that made the
   *   change, and it can arrive before the write resolves.
   * - Two contexts writing the queue back at the same moment, the second
   *   overwriting the first.
   *
   * So what this instance queued is held here until it is acknowledged, and is
   * folded back in on every read and every write. The disk can lose an entry
   * for a moment; the context that queued it cannot.
   */
  private own = new Map<string, OutboxEntry>();

  constructor(private readonly storage: StorageAdapter) {}

  /**
   * Read the shared queue.
   *
   * The disk is the authority for everything another context queued — if an
   * entry is gone, someone had it accepted. What this instance queued is folded
   * back in, and an entry this instance had accepted is not brought back just
   * because the disk has not caught up with the acknowledgement yet.
   */
  async load(): Promise<void> {
    const loaded = new Map((await this.storage.loadOutbox()).map((e) => [e.taskId, e]));
    this.foldOwn(loaded);
    this.dropAcknowledged(loaded);
    this.entries = loaded;
  }

  /**
   * Write the queue back, merging with whatever is already there.
   *
   * Entries on disk are the baseline, so anything queued elsewhere while this
   * instance was busy survives. This instance's own entries are folded in, and
   * an entry it had accepted is dropped only if the stored version is the one
   * it actually pushed. Entries it merely read from another context are not
   * written back: if the disk no longer has one, that context had it accepted.
   */
  async persist(): Promise<void> {
    const merged = new Map<string, OutboxEntry>();
    for (const entry of await this.storage.loadOutbox()) merged.set(entry.taskId, entry);
    this.foldOwn(merged);
    this.dropAcknowledged(merged);
    this.acknowledged.clear();

    await this.storage.saveOutbox([...merged.values()]);
  }

  /**
   * Add this instance's entries to `queue`, and hold the results.
   *
   * Where the queue already has another version of the same task — edited in
   * another window too — the two are merged field by field, the same rule the
   * server applies, so neither edit is lost from what gets pushed.
   */
  private foldOwn(queue: Map<string, OutboxEntry>): void {
    for (const [taskId, mine] of this.own) {
      const theirs = queue.get(taskId);
      const entry =
        !theirs || isSameVersion(theirs.snapshot, mine.snapshot)
          ? mine
          : {
              ...mine,
              snapshot: mergeTask(theirs.snapshot, mine.snapshot),
              queuedAt: theirs.queuedAt < mine.queuedAt ? theirs.queuedAt : mine.queuedAt,
              status: theirs.status === 'pending' ? 'pending' : mine.status,
            };
      queue.set(taskId, entry);
      this.own.set(taskId, entry);
      // Memory holds the same object, so what is pushed next is what was
      // written, and a failure recorded against it is recorded on both.
      this.entries.set(taskId, entry);
    }
  }

  private dropAcknowledged(queue: Map<string, OutboxEntry>): void {
    for (const [taskId, accepted] of this.acknowledged) {
      const held = queue.get(taskId);
      if (held && isSameVersion(held.snapshot, accepted)) queue.delete(taskId);
    }
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
    const entry: OutboxEntry = {
      taskId: task.id,
      snapshot: task,
      queuedAt: existing?.queuedAt ?? queuedAt,
      attempts: 0,
      // A fresh edit is a fresh chance: revive a parked entry rather than
      // stranding the user's newest change behind an old failure.
      status: 'pending',
      lastError: null,
    };
    this.entries.set(task.id, entry);
    this.own.set(task.id, entry);
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
      if (entry && isSameVersion(entry.snapshot, task)) {
        this.entries.delete(task.id);
        this.own.delete(task.id);
      }
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

  /** Forget everything held here, written or not — for sign-out, not for syncing. */
  clear(): void {
    this.entries.clear();
    this.own.clear();
    this.acknowledged.clear();
  }
}
