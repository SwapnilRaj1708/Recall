import { beforeEach, describe, expect, it } from 'vitest';
import {
  compareTasksInOrder,
  positionForNewCapture,
  positionsForNewCaptures,
} from '../src/model/fracIndex.js';
import { createTask } from '../src/model/task.js';
import { FakeServer } from '../src/testing/fakeServer.js';
import { makeClient, textsOf } from './helpers.js';

/**
 * The order of the list when tasks arrive from somewhere that cannot see it.
 *
 * Found on the phone: two links shared in a row, from Instagram then YouTube,
 * came out with YouTube second. The share receiver sends tasks straight to the
 * server using positions from a snapshot the app left it, and both shares were
 * given the same "top" position — so the two tasks tied, and a tie had no rule.
 */

const at = (position: string, createdAt: string, id: string) => ({ position, createdAt, id });

describe('positions for a run of captures', () => {
  const list = [{ position: 'a0' }, { position: 'a1' }, { position: 'a2' }];

  it('puts each capture at the top above the one before', () => {
    const keys = positionsForNewCaptures(list, 'top', 5);
    expect(new Set(keys).size).toBe(5);
    for (let i = 1; i < keys.length; i++) expect(keys[i]! < keys[i - 1]!).toBe(true);
    expect(keys.every((key) => key < 'a0')).toBe(true);
  });

  it('puts each capture at the bottom below the one before', () => {
    const keys = positionsForNewCaptures(list, 'bottom', 5);
    expect(new Set(keys).size).toBe(5);
    for (let i = 1; i < keys.length; i++) expect(keys[i]! > keys[i - 1]!).toBe(true);
    expect(keys.every((key) => key > 'a2')).toBe(true);
  });

  it('starts with exactly the position a single capture would get', () => {
    expect(positionsForNewCaptures(list, 'top', 3)[0]).toBe(positionForNewCapture(list, 'top'));
    expect(positionsForNewCaptures(list, 'bottom', 3)[0]).toBe(positionForNewCapture(list, 'bottom'));
  });

  it('works on an empty list', () => {
    expect(positionsForNewCaptures([], 'top', 3)).toHaveLength(3);
  });
});

describe('ties', () => {
  it('puts the newer of two equal positions first', () => {
    const older = at('a0', '2026-11-01T14:16:20.000Z', 'b');
    const newer = at('a0', '2026-11-01T14:20:00.000Z', 'a');
    expect([older, newer].sort(compareTasksInOrder)).toEqual([newer, older]);
  });

  it('still orders by position first', () => {
    const top = at('Zz', '2026-01-01T00:00:00.000Z', 'x');
    const below = at('a0', '2026-12-01T00:00:00.000Z', 'y');
    expect([below, top].sort(compareTasksInOrder)).toEqual([top, below]);
  });

  it('settles even a complete tie the same way on every device', () => {
    const one = at('a0', '2026-01-01T00:00:00.000Z', 'a');
    const two = at('a0', '2026-01-01T00:00:00.000Z', 'b');
    expect([two, one].sort(compareTasksInOrder)).toEqual([one, two]);
  });
});

describe('the case that was reported', () => {
  let server: FakeServer;
  beforeEach(() => {
    server = new FakeServer();
  });

  /** A task as the share receiver sends it: its own position and clocks. */
  function shared(text: string, position: string, createdAt: string) {
    const clock = { now: () => createdAt } as never;
    return { ...createTask(text, position, clock), createdAt };
  }

  it('shows the later of two shares first, with positions from one snapshot', async () => {
    const { engine } = makeClient(server);
    await engine.start();
    await engine.capture('already on the list');

    // What the app left in the snapshot, and what two shares in a row take.
    const [first, second] = positionsForNewCaptures(engine.getTasks(), 'top', 2);
    server.push('user-1', [
      shared('instagram link', first!, '2026-11-01T14:16:20.000Z'),
      shared('youtube link', second!, '2026-11-01T14:20:00.000Z'),
    ]);
    await engine.syncNow();

    expect(textsOf(engine.getOpenTasks())).toEqual([
      'youtube link',
      'instagram link',
      'already on the list',
    ]);
  });

  it('shows them newest first even when they did get the same position', async () => {
    // How the two links already on the server were sent, before the fix.
    const { engine } = makeClient(server);
    await engine.start();
    const position = positionForNewCapture([], 'top');
    // In the order they were shared, which is the order they reach the client.
    server.push('user-1', [shared('instagram link', position, '2026-11-01T14:16:20.000Z')]);
    server.push('user-1', [shared('youtube link', position, '2026-11-01T14:20:00.000Z')]);
    await engine.syncNow();

    expect(textsOf(engine.getOpenTasks())).toEqual(['youtube link', 'instagram link']);
  });
});
