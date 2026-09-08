import { isNewer, maxTimestamp } from './clock.js';
import type { Task } from './types.js';

/**
 * Merge two versions of the same task, field by field.
 *
 * This single function resolves every concurrency situation the system can
 * produce — offline reconnection, duplicate realtime delivery, out-of-order
 * delivery, and simultaneous edits on two devices — because all of them reduce
 * to "here is another version of this row". Making one function responsible for
 * all of them is what makes the behaviour testable.
 *
 * Convergence relies on the server applying the identical rule and returning
 * the winning row from every push, so a client that loses a comparison learns
 * the truth on the next round trip rather than holding a divergent value.
 */
export function mergeTask(local: Task | undefined, incoming: Task): Task {
  if (!local) return withDerivedUpdatedAt(incoming);
  if (local.id !== incoming.id) {
    throw new Error(`Refusing to merge different tasks: ${local.id} vs ${incoming.id}`);
  }

  const textWins = isNewer(incoming.textUpdatedAt, local.textUpdatedAt);
  const completedWins = isNewer(incoming.completedUpdatedAt, local.completedUpdatedAt);
  const positionWins = isNewer(incoming.positionUpdatedAt, local.positionUpdatedAt);
  const deletedWins = isNewer(incoming.deletedUpdatedAt, local.deletedUpdatedAt);

  return withDerivedUpdatedAt({
    id: local.id,

    text: textWins ? incoming.text : local.text,
    textUpdatedAt: textWins ? incoming.textUpdatedAt : local.textUpdatedAt,

    // `completed` and `completedAt` describe one state change and share a clock,
    // so they must move together or the timestamp can end up describing the
    // opposite of the boolean.
    completed: completedWins ? incoming.completed : local.completed,
    completedAt: completedWins ? incoming.completedAt : local.completedAt,
    completedUpdatedAt: completedWins ? incoming.completedUpdatedAt : local.completedUpdatedAt,

    position: positionWins ? incoming.position : local.position,
    positionUpdatedAt: positionWins ? incoming.positionUpdatedAt : local.positionUpdatedAt,

    deletedAt: deletedWins ? incoming.deletedAt : local.deletedAt,
    deletedUpdatedAt: deletedWins ? incoming.deletedUpdatedAt : local.deletedUpdatedAt,

    // Creation is immutable, so the earliest claim is the honest one. Taking the
    // minimum keeps this stable no matter which replica is seen first.
    createdAt: local.createdAt < incoming.createdAt ? local.createdAt : incoming.createdAt,

    updatedAt: local.updatedAt,
  });
}

/** `updatedAt` is derived, never merged — recompute it from the field clocks. */
export function withDerivedUpdatedAt(task: Task): Task {
  const updatedAt = maxTimestamp(
    task.textUpdatedAt,
    task.completedUpdatedAt,
    task.positionUpdatedAt,
    task.deletedUpdatedAt,
  );
  return updatedAt === task.updatedAt ? task : { ...task, updatedAt };
}

/** True when two versions are identical in every replicated field. */
export function isSameVersion(a: Task, b: Task): boolean {
  return (
    a.id === b.id &&
    a.text === b.text &&
    a.completed === b.completed &&
    a.completedAt === b.completedAt &&
    a.position === b.position &&
    a.deletedAt === b.deletedAt &&
    a.textUpdatedAt === b.textUpdatedAt &&
    a.completedUpdatedAt === b.completedUpdatedAt &&
    a.positionUpdatedAt === b.positionUpdatedAt &&
    a.deletedUpdatedAt === b.deletedUpdatedAt
  );
}

/**
 * Merge a batch into a map in place, returning only the tasks that actually
 * changed — so the UI re-renders for real updates and ignores echoes of its own
 * writes coming back over the realtime channel.
 */
export function mergeAll(map: Map<string, Task>, incoming: readonly Task[]): Task[] {
  const changed: Task[] = [];
  for (const next of incoming) {
    const current = map.get(next.id);
    const merged = mergeTask(current, next);
    if (!current || !isSameVersion(current, merged)) {
      map.set(merged.id, merged);
      changed.push(merged);
    }
  }
  return changed;
}
