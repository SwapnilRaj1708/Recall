import { isNewer } from '../model/clock.js';
import { withDerivedUpdatedAt } from '../model/merge.js';
import type { Task } from '../model/types.js';
import {
  AuthSyncError,
  PermanentSyncError,
  TransientSyncError,
  type PullResult,
  type RealtimeState,
  type RemoteAdapter,
} from '../sync/types.js';

interface StoredRow {
  task: Task;
  userId: string;
  /** Monotonic, zero-padded so lexicographic comparison is chronological. */
  serverUpdatedAt: string;
}

type Subscriber = (userId: string, tasks: Task[]) => void;

/**
 * An in-memory stand-in for the Postgres side, implementing exactly the merge
 * rules that `push_tasks` implements in SQL.
 *
 * The convergence tests run two real SyncEngine instances against one of these.
 * That is the only way to test the properties that actually matter — offline
 * reconnection, duplicate and out-of-order delivery, simultaneous edits —
 * without a live database in the loop.
 */
export class FakeServer {
  private rows = new Map<string, StoredRow>();
  private subscribers = new Set<Subscriber>();
  private sequence = 0;

  /** Rejects rows whose text is empty, mirroring the column CHECK constraint. */
  validateText = true;

  private nextStamp(): string {
    return String(++this.sequence).padStart(12, '0');
  }

  /**
   * Per-field last-write-wins upsert. Returns the winning version of every
   * submitted row so a caller that lost a comparison can correct itself.
   */
  push(userId: string, incoming: readonly Task[]): Task[] {
    const winners: Task[] = [];
    const broadcast: Task[] = [];

    for (const candidate of incoming) {
      if (this.validateText && candidate.text.trim().length === 0) {
        throw new PermanentSyncError(`Task ${candidate.id} has empty text`);
      }

      const existing = this.rows.get(candidate.id);

      if (!existing) {
        const row: StoredRow = {
          task: withDerivedUpdatedAt({ ...candidate }),
          userId,
          serverUpdatedAt: this.nextStamp(),
        };
        this.rows.set(candidate.id, row);
        winners.push(row.task);
        broadcast.push(row.task);
        continue;
      }

      if (existing.userId !== userId) {
        // Row-level security: another user's row is simply not visible.
        throw new PermanentSyncError(`Task ${candidate.id} is not accessible`);
      }

      const current = existing.task;
      const textWins = isNewer(candidate.textUpdatedAt, current.textUpdatedAt);
      const completedWins = isNewer(candidate.completedUpdatedAt, current.completedUpdatedAt);
      const positionWins = isNewer(candidate.positionUpdatedAt, current.positionUpdatedAt);
      const deletedWins = isNewer(candidate.deletedUpdatedAt, current.deletedUpdatedAt);

      const merged = withDerivedUpdatedAt({
        id: current.id,
        text: textWins ? candidate.text : current.text,
        textUpdatedAt: textWins ? candidate.textUpdatedAt : current.textUpdatedAt,
        completed: completedWins ? candidate.completed : current.completed,
        completedAt: completedWins ? candidate.completedAt : current.completedAt,
        completedUpdatedAt: completedWins
          ? candidate.completedUpdatedAt
          : current.completedUpdatedAt,
        position: positionWins ? candidate.position : current.position,
        positionUpdatedAt: positionWins ? candidate.positionUpdatedAt : current.positionUpdatedAt,
        deletedAt: deletedWins ? candidate.deletedAt : current.deletedAt,
        deletedUpdatedAt: deletedWins ? candidate.deletedUpdatedAt : current.deletedUpdatedAt,
        createdAt: current.createdAt < candidate.createdAt ? current.createdAt : candidate.createdAt,
        updatedAt: current.updatedAt,
      });

      const changed = textWins || completedWins || positionWins || deletedWins;
      if (changed) {
        existing.task = merged;
        existing.serverUpdatedAt = this.nextStamp();
        broadcast.push(merged);
      }
      winners.push(merged);
    }

    if (broadcast.length > 0) this.emit(userId, broadcast);
    return winners.map(clone);
  }

  pull(userId: string, cursor: string | null, limit: number): PullResult {
    const page = [...this.rows.values()]
      .filter((row) => row.userId === userId)
      .filter((row) => cursor === null || row.serverUpdatedAt > cursor)
      .sort((a, b) => a.serverUpdatedAt.localeCompare(b.serverUpdatedAt));

    const slice = page.slice(0, limit);
    const last = slice.at(-1);
    return {
      tasks: slice.map((row) => clone(row.task)),
      cursor: last?.serverUpdatedAt ?? cursor,
      hasMore: page.length > limit,
    };
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  private emit(userId: string, tasks: Task[]): void {
    const payload = tasks.map(clone);
    for (const fn of this.subscribers) fn(userId, payload);
  }

  /** Direct read for assertions. */
  snapshot(userId: string): Task[] {
    return [...this.rows.values()]
      .filter((row) => row.userId === userId)
      .map((row) => clone(row.task))
      .sort((a, b) => a.position.localeCompare(b.position));
  }

  get(id: string): Task | undefined {
    const row = this.rows.get(id);
    return row ? clone(row.task) : undefined;
  }
}

export type FailureMode = 'none' | 'offline' | 'auth' | 'permanent';

/**
 * A client connection to a FakeServer, with the knobs the tests need: pull the
 * network, expire the session, drop the realtime channel, duplicate or reorder
 * delivery.
 */
export class FakeRemote implements RemoteAdapter {
  failureMode: FailureMode = 'none';
  /** Deliver every realtime payload twice, to prove duplicates are harmless. */
  duplicateRealtime = false;
  pushCount = 0;
  pullCount = 0;

  private unsubscribeServer: (() => void) | null = null;
  private onTasks: ((tasks: Task[]) => void) | null = null;
  private onState: ((state: RealtimeState) => void) | null = null;
  private realtimeConnected = false;

  constructor(
    private readonly server: FakeServer,
    private userId: string | null,
  ) {}

  getUserId(): string | null {
    return this.userId;
  }

  setUserId(userId: string | null): void {
    this.userId = userId;
  }

  private guard(): string {
    if (this.failureMode === 'offline') throw new TransientSyncError('Network request failed');
    if (this.failureMode === 'auth') throw new AuthSyncError('JWT expired');
    if (this.failureMode === 'permanent') throw new PermanentSyncError('Invalid request');
    const userId = this.userId;
    if (!userId) throw new AuthSyncError('Not signed in');
    return userId;
  }

  async push(tasks: readonly Task[]): Promise<Task[]> {
    this.pushCount++;
    const userId = this.guard();
    return this.server.push(userId, tasks);
  }

  async pull(cursor: string | null, limit: number): Promise<PullResult> {
    this.pullCount++;
    const userId = this.guard();
    return this.server.pull(userId, cursor, limit);
  }

  subscribe(handlers: {
    onTasks: (tasks: Task[]) => void;
    onState: (state: RealtimeState) => void;
  }): () => void {
    this.onTasks = handlers.onTasks;
    this.onState = handlers.onState;

    this.unsubscribeServer = this.server.subscribe((userId, tasks) => {
      if (!this.realtimeConnected) return;
      if (userId !== this.userId) return;
      this.onTasks?.(tasks);
      if (this.duplicateRealtime) this.onTasks?.(tasks);
    });

    this.connectRealtime();

    return () => {
      this.unsubscribeServer?.();
      this.unsubscribeServer = null;
      this.realtimeConnected = false;
    };
  }

  connectRealtime(): void {
    this.realtimeConnected = true;
    this.onState?.('connected');
  }

  dropRealtime(): void {
    this.realtimeConnected = false;
    this.onState?.('disconnected');
  }

  /** Replay a set of versions straight into the client, in any order. */
  deliver(tasks: Task[]): void {
    this.onTasks?.(tasks.map(clone));
  }

  goOffline(): void {
    this.failureMode = 'offline';
    this.dropRealtime();
  }

  goOnline(): void {
    this.failureMode = 'none';
    this.connectRealtime();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
