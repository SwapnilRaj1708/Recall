import { clock as defaultClock, type Clock } from './clock.js';
import { withDerivedUpdatedAt } from './merge.js';
import { MAX_TEXT_LENGTH, type Task } from './types.js';

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older WebViews. Not cryptographically strong, but ids only
  // need to be unique, and a collision would require the same 122 random bits.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Capture is meant to be thoughtless, so text arrives with stray whitespace and
 * occasionally pasted newlines. Normalising here keeps every entry point — the
 * widget, the omnibox, the context menu — consistent.
 */
export function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
}

export function isBlank(raw: string): boolean {
  return normalizeText(raw).length === 0;
}

export function createTask(
  text: string,
  position: string,
  clock: Clock = defaultClock,
  /**
   * Supply the id when the task already has one.
   *
   * Ids are client-generated everywhere in this system, so a surface that
   * cannot reach the engine — the Android home-screen widget — can still mint
   * one at the moment of capture. Replaying that capture later then converges
   * on the same row instead of creating a second copy, which matters because
   * the widget's queue is delivered at least once by design: losing a capture
   * is unrecoverable, while a duplicate is merely annoying.
   */
  id: string = newId(),
): Task {
  const now = clock.now();
  return withDerivedUpdatedAt({
    id,
    text: normalizeText(text),
    completed: false,
    completedAt: null,
    position,
    deletedAt: null,
    createdAt: now,
    textUpdatedAt: now,
    completedUpdatedAt: now,
    positionUpdatedAt: now,
    deletedUpdatedAt: now,
    updatedAt: now,
  });
}

export function withText(task: Task, text: string, clock: Clock = defaultClock): Task {
  const now = clock.now();
  return withDerivedUpdatedAt({ ...task, text: normalizeText(text), textUpdatedAt: now });
}

export function withCompleted(task: Task, completed: boolean, clock: Clock = defaultClock): Task {
  const now = clock.now();
  return withDerivedUpdatedAt({
    ...task,
    completed,
    completedAt: completed ? now : null,
    completedUpdatedAt: now,
  });
}

export function withPosition(task: Task, position: string, clock: Clock = defaultClock): Task {
  const now = clock.now();
  return withDerivedUpdatedAt({ ...task, position, positionUpdatedAt: now });
}

/**
 * Deletion is a tombstone, never a row removal. The tombstone is what lets the
 * delete reach other devices at all, and it is what makes undo possible after
 * the fact — which matters more than usual when the app is standing in for the
 * user's memory.
 */
export function withDeleted(task: Task, deleted: boolean, clock: Clock = defaultClock): Task {
  const now = clock.now();
  return withDerivedUpdatedAt({
    ...task,
    deletedAt: deleted ? now : null,
    deletedUpdatedAt: now,
  });
}

export const isDeleted = (task: Task): boolean => task.deletedAt !== null;
export const isActive = (task: Task): boolean => task.deletedAt === null;
export const isOpen = (task: Task): boolean => task.deletedAt === null && !task.completed;

/** How long tombstones are retained before they can be purged. */
export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function isPurgeableTombstone(task: Task, nowMs: number = Date.now()): boolean {
  if (!task.deletedAt) return false;
  return nowMs - Date.parse(task.deletedAt) > TOMBSTONE_RETENTION_MS;
}
