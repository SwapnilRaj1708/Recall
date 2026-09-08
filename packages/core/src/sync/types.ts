import type { Task } from '../model/types.js';

/**
 * One pending mutation, keyed by task.
 *
 * The entry stores the complete local version of the task rather than a diff.
 * Because the server merges per field, sending the whole row is safe: fields the
 * user did not touch carry old clocks and simply lose to whatever the server
 * already has. This makes the outbox self-coalescing — five rapid edits to one
 * task collapse into one entry — and makes retries idempotent, so a push that
 * times out ambiguously can always be sent again.
 */
export interface OutboxEntry {
  taskId: string;
  snapshot: Task;
  queuedAt: string;
  attempts: number;
  status: 'pending' | 'failed';
  lastError: string | null;
}

export interface PullResult {
  tasks: Task[];
  /** Server cursor to resume from; null when nothing new arrived. */
  cursor: string | null;
  /** True when the server had more rows than this page returned. */
  hasMore: boolean;
}

export type RealtimeState = 'connecting' | 'connected' | 'disconnected';

/**
 * Everything the sync engine needs from a backend.
 *
 * The engine is written against this interface rather than against Supabase so
 * the convergence tests can drive two real engines against one in-memory server
 * that implements the same merge semantics as the SQL function.
 */
export interface RemoteAdapter {
  /** Current authenticated user, or null when signed out. */
  getUserId(): string | null;

  /**
   * Upsert a batch and return the winning version of every submitted row.
   * Returning the winner (not just an ack) is what lets a client that lost a
   * per-field comparison correct itself immediately.
   */
  push(tasks: readonly Task[]): Promise<Task[]>;

  /** Rows whose server clock is strictly after `cursor`, oldest first. */
  pull(cursor: string | null, limit: number): Promise<PullResult>;

  /** Live change feed. Returns an unsubscribe function. */
  subscribe(handlers: {
    onTasks: (tasks: Task[]) => void;
    onState: (state: RealtimeState) => void;
  }): () => void;
}

/** Errors the engine must not retry — the request itself is invalid. */
export class PermanentSyncError extends Error {
  override readonly name = 'PermanentSyncError';
}

/** Errors that mean "try again later" — offline, timeout, 5xx, rate limit. */
export class TransientSyncError extends Error {
  override readonly name = 'TransientSyncError';
}

/** The session expired or was revoked; refresh credentials and retry. */
export class AuthSyncError extends Error {
  override readonly name = 'AuthSyncError';
}
