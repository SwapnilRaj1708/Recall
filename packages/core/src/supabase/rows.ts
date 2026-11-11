import { withDerivedUpdatedAt } from '../model/merge.js';
import { NEVER, type Task } from '../model/types.js';

/** The `public.tasks` row shape, exactly as Postgres returns it. */
export interface TaskRow {
  id: string;
  user_id?: string;
  text: string;
  completed: boolean;
  completed_at: string | null;
  position: string;
  deleted_at: string | null;
  /** Absent from rows written before migration 0004. */
  saved_at?: string | null;
  created_at: string;
  text_updated_at: string;
  completed_updated_at: string;
  position_updated_at: string;
  deleted_updated_at: string;
  saved_updated_at?: string;
  updated_at: string;
  server_updated_at?: string;
}

export function fromRow(row: TaskRow): Task {
  return withDerivedUpdatedAt({
    id: row.id,
    text: row.text,
    completed: row.completed,
    completedAt: row.completed_at,
    position: row.position,
    deletedAt: row.deleted_at,
    savedAt: row.saved_at ?? null,
    createdAt: row.created_at,
    textUpdatedAt: row.text_updated_at,
    completedUpdatedAt: row.completed_updated_at,
    positionUpdatedAt: row.position_updated_at,
    deletedUpdatedAt: row.deleted_updated_at,
    // Missing until the database has the column: never set, so any real
    // choice made on a device wins over it.
    savedUpdatedAt: row.saved_updated_at ?? NEVER,
    updatedAt: row.updated_at,
  });
}

/**
 * `user_id` is deliberately absent: the SQL function stamps it from
 * `auth.uid()`, so a client cannot write a row into anyone else's list even if
 * it tries.
 */
export function toRow(task: Task): Omit<TaskRow, 'user_id' | 'server_updated_at'> {
  return {
    id: task.id,
    text: task.text,
    completed: task.completed,
    completed_at: task.completedAt,
    position: task.position,
    deleted_at: task.deletedAt,
    saved_at: task.savedAt,
    created_at: task.createdAt,
    text_updated_at: task.textUpdatedAt,
    completed_updated_at: task.completedUpdatedAt,
    position_updated_at: task.positionUpdatedAt,
    deleted_updated_at: task.deletedUpdatedAt,
    saved_updated_at: task.savedUpdatedAt,
    updated_at: task.updatedAt,
  };
}
