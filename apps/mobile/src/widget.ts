import type { Task } from '@recall/core';
import { invoke } from '@tauri-apps/api/core';

/**
 * Publishing the list for the home-screen widget.
 *
 * The widget renders `RemoteViews` in this app's process but outside the
 * webview, so it cannot read the IndexedDB mirror everything else uses. The app
 * therefore writes a snapshot the widget can paint from with no network and no
 * webview — which is also what lets the widget appear instantly rather than
 * after a cold start.
 *
 * Only what the widget draws is included. The snapshot lands in app-private
 * storage, but a task list is still the user's own text, and there is no reason
 * to copy fields nothing renders.
 */
export interface WidgetTask {
  id: string;
  text: string;
  completed: boolean;
}

export interface WidgetState {
  /** Bumped when the shape changes, so a stale reader can decline to guess. */
  version: 1;
  /** When this snapshot was taken, so the widget can show its age if it wants. */
  publishedAt: string;
  signedIn: boolean;
  tasks: WidgetTask[];
}

/**
 * The widget shows a handful of rows at most, and a very long list would make
 * the file large enough to matter on every publish. Beyond this the user is
 * going to open the app anyway.
 */
const MAX_TASKS = 200;

export function buildWidgetState(tasks: Task[], signedIn: boolean): WidgetState {
  return {
    version: 1,
    publishedAt: new Date().toISOString(),
    signedIn,
    tasks: tasks.slice(0, MAX_TASKS).map((task) => ({
      id: task.id,
      text: task.text,
      completed: task.completed,
    })),
  };
}

/** Two snapshots that would render identically are not worth a disk write. */
export function sameWidgetState(a: WidgetState | null, b: WidgetState): boolean {
  if (!a) return false;
  if (a.signedIn !== b.signedIn) return false;
  if (a.tasks.length !== b.tasks.length) return false;
  return a.tasks.every((task, index) => {
    const other = b.tasks[index]!;
    return task.id === other.id && task.text === other.text && task.completed === other.completed;
  });
}

/**
 * Hand the snapshot to the shell.
 *
 * Never throws: a widget that fails to update is a bad day, but a capture that
 * fails because the widget could not be updated would be a lost thought, and
 * this runs on the same path as capture.
 */
export async function publishWidgetState(state: WidgetState): Promise<string | null> {
  try {
    return await invoke<string>('publish_widget_state', { payload: JSON.stringify(state) });
  } catch (error) {
    console.warn('[recall] could not publish widget state', error);
    return null;
  }
}

/* ------------------------------------------------------ widget -> app */

/**
 * An action taken on the home-screen widget while the app was not running.
 *
 * The widget cannot reach the sync engine, so it records what it did. Replaying
 * these through the engine — rather than writing them to the server directly —
 * is what gives them ordering, the outbox, and the same per-field merge every
 * other surface goes through, for free.
 */
export interface WidgetOp {
  kind: 'capture' | 'setCompleted' | 'setText' | 'remove';
  id: string;
  text?: string;
  completed?: boolean;
  at?: string;
}

const OP_KINDS = new Set<WidgetOp['kind']>(['capture', 'setCompleted', 'setText', 'remove']);

/** Ignore anything malformed rather than letting it stall the whole drain. */
export function parseWidgetOps(raw: string): WidgetOp[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((entry): WidgetOp[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const kind = record.kind;
    const id = record.id;
    if (typeof kind !== 'string' || !OP_KINDS.has(kind as WidgetOp['kind'])) return [];
    if (typeof id !== 'string' || id.length === 0) return [];
    return [
      {
        kind: kind as WidgetOp['kind'],
        id,
        ...(typeof record.text === 'string' ? { text: record.text } : {}),
        ...(typeof record.completed === 'boolean' ? { completed: record.completed } : {}),
        ...(typeof record.at === 'string' ? { at: record.at } : {}),
      },
    ];
  });
}

/**
 * Claim whatever the widget has queued, without discarding it.
 *
 * The shell holds the batch aside until [confirmWidgetOps] says it landed, so
 * a crash between claiming and applying re-offers the same work rather than
 * losing it. Delivery is therefore at-least-once, which is why every operation
 * carries the id the widget minted.
 */
export async function takeWidgetOps(): Promise<WidgetOp[]> {
  try {
    return parseWidgetOps(await invoke<string>('take_widget_ops'));
  } catch (error) {
    console.warn('[recall] could not read widget actions', error);
    return [];
  }
}

/** Tell the shell the claimed batch was applied and can be dropped. */
export async function confirmWidgetOps(): Promise<void> {
  try {
    await invoke('clear_widget_ops');
  } catch (error) {
    // Leaving them claimed means they are simply offered again next time,
    // which the ids make harmless.
    console.warn('[recall] could not clear widget actions', error);
  }
}

/**
 * Replay the widget's actions through the engine.
 *
 * Through the engine rather than to the server directly, so they pick up
 * ordering, the outbox, and the same per-field merge as every other surface.
 */
export async function applyWidgetOps(
  ops: WidgetOp[],
  engine: {
    capture: (text: string, id?: string) => Promise<unknown>;
    setText: (id: string, text: string) => Promise<unknown>;
    setCompleted: (id: string, completed: boolean) => Promise<unknown>;
    remove: (id: string) => Promise<unknown>;
  },
): Promise<number> {
  let applied = 0;
  for (const op of ops) {
    try {
      switch (op.kind) {
        case 'capture':
          if (op.text) await engine.capture(op.text, op.id);
          break;
        case 'setText':
          if (op.text) await engine.setText(op.id, op.text);
          break;
        case 'setCompleted':
          if (op.completed !== undefined) await engine.setCompleted(op.id, op.completed);
          break;
        case 'remove':
          await engine.remove(op.id);
          break;
      }
      applied += 1;
    } catch (error) {
      // One bad operation must not strand the rest of the batch.
      console.warn('[recall] could not apply widget action', op, error);
    }
  }
  return applied;
}
