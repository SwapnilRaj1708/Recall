import { describe, expect, it, vi } from 'vitest';
import {
  applyWidgetOps,
  buildWidgetState,
  parseWidgetOps,
  sameWidgetState,
  type WidgetOp,
} from '../src/widget.js';

/**
 * The bridge between the app and the home-screen widget.
 *
 * The widget renders outside the webview and cannot reach the sync engine, so
 * the app publishes a snapshot for it to draw and replays whatever was tapped
 * on it. Both directions fail quietly if they are wrong — a stale widget looks
 * like an empty to-do list, and a dropped operation looks like a task that was
 * never captured — which is why they are pinned here rather than left to a
 * manual check on the device.
 */

const task = (id: string, text: string, completed = false) =>
  ({
    id,
    text,
    completed,
    completedAt: null,
    position: 'a0',
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    textUpdatedAt: '2026-01-01T00:00:00.000Z',
    completedUpdatedAt: '2026-01-01T00:00:00.000Z',
    positionUpdatedAt: '2026-01-01T00:00:00.000Z',
    deletedUpdatedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as never;

describe('the snapshot the widget draws', () => {
  it('carries only what the widget renders', () => {
    const state = buildWidgetState([task('a', 'Buy milk')], true);
    expect(state.tasks).toEqual([{ id: 'a', text: 'Buy milk', completed: false }]);
  });

  it('records whether anyone is signed in', () => {
    // A signed-out widget has to say so, rather than show an empty list that
    // reads as "nothing to do".
    expect(buildWidgetState([], false).signedIn).toBe(false);
    expect(buildWidgetState([], true).signedIn).toBe(true);
  });

  it('caps a very long list, which the widget could not show anyway', () => {
    const many = Array.from({ length: 500 }, (_, index) => task(`t${index}`, `task ${index}`));
    expect(buildWidgetState(many, true).tasks.length).toBe(200);
  });
});

describe('deciding whether to write a snapshot', () => {
  it('skips a write when nothing the widget draws has changed', () => {
    // This runs on the capture path, so it must not touch the disk for a
    // change the widget would render identically.
    const a = buildWidgetState([task('a', 'Buy milk')], true);
    const b = buildWidgetState([task('a', 'Buy milk')], true);
    expect(sameWidgetState(a, b)).toBe(true);
  });

  it.each([
    ['text', [task('a', 'Buy oat milk')], true],
    ['completion', [task('a', 'Buy milk', true)], true],
    ['order', [task('b', 'Second'), task('a', 'Buy milk')], true],
    ['sign-in', [task('a', 'Buy milk')], false],
  ])('writes when %s changed', (_what, tasks, signedIn) => {
    const before = buildWidgetState([task('a', 'Buy milk')], true);
    expect(sameWidgetState(before, buildWidgetState(tasks, signedIn))).toBe(false);
  });

  it('always writes the first time', () => {
    expect(sameWidgetState(null, buildWidgetState([], true))).toBe(false);
  });
});

describe('reading what the widget queued', () => {
  it('reads a well-formed queue', () => {
    const ops = parseWidgetOps(
      JSON.stringify([
        { kind: 'capture', id: 'w1', text: 'From the widget', at: '2026-01-01T00:00:00Z' },
        { kind: 'setCompleted', id: 'a', completed: true },
        { kind: 'remove', id: 'b' },
      ]),
    );
    expect(ops.map((op) => op.kind)).toEqual(['capture', 'setCompleted', 'remove']);
    expect(ops[0]!.text).toBe('From the widget');
    expect(ops[1]!.completed).toBe(true);
  });

  it.each([
    ['not JSON at all', 'not json'],
    ['not an array', '{"kind":"capture"}'],
    ['empty', '[]'],
  ])('survives a queue that is %s', (_case, raw) => {
    expect(parseWidgetOps(raw)).toEqual([]);
  });

  it('drops malformed entries but keeps the rest of the batch', () => {
    // One corrupt entry must not cost the user every other capture in it.
    const ops = parseWidgetOps(
      JSON.stringify([
        { kind: 'nonsense', id: 'x' },
        { kind: 'capture' },
        { kind: 'capture', id: '', text: 'no id' },
        null,
        'string',
        { kind: 'capture', id: 'good', text: 'survivor' },
      ]),
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]!.id).toBe('good');
  });
});

describe('replaying what the widget queued', () => {
  const spyEngine = () => ({
    capture: vi.fn().mockResolvedValue(null),
    setText: vi.fn().mockResolvedValue(null),
    setCompleted: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(null),
  });

  it('replays a capture under the id the widget minted', async () => {
    // Delivery is at-least-once by design, so the id is what stops a replay
    // from creating a second copy of the same thought.
    const engine = spyEngine();
    await applyWidgetOps([{ kind: 'capture', id: 'w1', text: 'From the widget' }], engine);
    expect(engine.capture).toHaveBeenCalledWith('From the widget', 'w1');
  });

  it('replays each kind through its own engine method', async () => {
    const engine = spyEngine();
    const ops: WidgetOp[] = [
      { kind: 'setText', id: 'a', text: 'Edited' },
      { kind: 'setCompleted', id: 'b', completed: true },
      { kind: 'remove', id: 'c' },
    ];
    await applyWidgetOps(ops, engine);
    expect(engine.setText).toHaveBeenCalledWith('a', 'Edited');
    expect(engine.setCompleted).toHaveBeenCalledWith('b', true);
    expect(engine.remove).toHaveBeenCalledWith('c');
  });

  it('applies operations in the order they were queued', async () => {
    // Completing then editing is a different outcome from editing then
    // completing, and the widget recorded which one happened.
    const order: string[] = [];
    const engine = {
      capture: vi.fn(async () => void order.push('capture')),
      setText: vi.fn(async () => void order.push('setText')),
      setCompleted: vi.fn(async () => void order.push('setCompleted')),
      remove: vi.fn(async () => void order.push('remove')),
    };
    await applyWidgetOps(
      [
        { kind: 'capture', id: 'a', text: 'one' },
        { kind: 'setCompleted', id: 'a', completed: true },
        { kind: 'setText', id: 'a', text: 'two' },
      ],
      engine,
    );
    expect(order).toEqual(['capture', 'setCompleted', 'setText']);
  });

  it('does not strand the rest of a batch when one operation throws', async () => {
    const engine = spyEngine();
    engine.setCompleted.mockRejectedValueOnce(new Error('nope'));
    const applied = await applyWidgetOps(
      [
        { kind: 'setCompleted', id: 'a', completed: true },
        { kind: 'capture', id: 'b', text: 'still captured' },
      ],
      engine,
    );
    expect(engine.capture).toHaveBeenCalledWith('still captured', 'b');
    expect(applied).toBe(1);
  });

  it('ignores operations missing the field they need', async () => {
    const engine = spyEngine();
    await applyWidgetOps(
      [
        { kind: 'capture', id: 'a' },
        { kind: 'setText', id: 'b' },
        { kind: 'setCompleted', id: 'c' },
      ],
      engine,
    );
    expect(engine.capture).not.toHaveBeenCalled();
    expect(engine.setText).not.toHaveBeenCalled();
    expect(engine.setCompleted).not.toHaveBeenCalled();
  });
});
