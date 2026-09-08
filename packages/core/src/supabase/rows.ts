import { withDerivedUpdatedAt } from '../model/merge.js';
import type { Task } from '../model/types.js';

/** The `public.tasks` row shape, exactly as Postgres returns it. */
export interface TaskRow {
  id: string;
  user_id?: string;
  text: string;
  completed: boolean;
  completed_at: string | null;
  position: string;
  deleted_at: string | null;
  created_at: string;
  text_updated_at: string;
  completed_updated_at: string;
  position_updated_at: string;
  deleted_updated_at: string;
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
    createdAt: row.created_at,
    textUpdatedAt: row.text_updated_at,
    completedUpdatedAt: row.completed_updated_at,
    positionUpdatedAt: row.position_updated_at,
    deletedUpdatedAt: row.deleted_updated_at,
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
    created_at: task.createdAt,
    text_updated_at: task.textUpdatedAt,
    completed_updated_at: task.completedUpdatedAt,
    position_updated_at: task.positionUpdatedAt,
    deleted_updated_at: task.deletedUpdatedAt,
    updated_at: task.updatedAt,
  };
}
