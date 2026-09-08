/**
 * The canonical task shape, shared by every surface.
 *
 * Each mutable field carries its own logical timestamp so that two devices
 * editing *different* fields of the same task while one is offline both keep
 * their change. Row-level last-write-wins would silently discard one of them.
 */
export interface Task {
  /** Client-generated UUID, so a task has a stable identity before it ever reaches the server. */
  id: string;
  text: string;
  completed: boolean;
  completedAt: string | null;
  /** Fractional index. Lexicographic order of this string is the list order. */
  position: string;
  /** Tombstone. Non-null means deleted; kept so deletes replicate and stay undoable. */
  deletedAt: string | null;
  createdAt: string;

  // Per-field logical clocks (ISO-8601 UTC, millisecond precision).
  textUpdatedAt: string;
  completedUpdatedAt: string;
  positionUpdatedAt: string;
  deletedUpdatedAt: string;

  /** greatest() of the field clocks. Display and sort only — never used to merge. */
  updatedAt: string;
}

/** Fields a client may change. Used to type mutations and merge results. */
export type TaskField = 'text' | 'completed' | 'position' | 'deleted';

export const TASK_FIELDS: readonly TaskField[] = ['text', 'completed', 'position', 'deleted'];

/** Maps each mutable field to the property holding its logical clock. */
export const FIELD_CLOCK: Record<TaskField, keyof Task> = {
  text: 'textUpdatedAt',
  completed: 'completedUpdatedAt',
  position: 'positionUpdatedAt',
  deleted: 'deletedUpdatedAt',
};

export const MAX_TEXT_LENGTH = 2000;

export interface SyncStatus {
  /** Browser/OS reports a network connection. */
  online: boolean;
  /** A realtime channel is currently connected. */
  live: boolean;
  /** A push or pull is in flight. */
  syncing: boolean;
  /** Number of local mutations not yet acknowledged by the server. */
  pending: number;
  /** Number of outbox entries the server permanently rejected. */
  failed: number;
  lastSyncedAt: string | null;
  /** Human-readable description of the most recent sync failure, if any. */
  error: string | null;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out'; error?: string }
  | { status: 'signed-in'; userId: string; email: string | null };
