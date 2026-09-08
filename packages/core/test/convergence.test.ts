import { beforeEach, describe, expect, it } from 'vitest';
import type { SyncEngine } from '../src/sync/engine.js';
import { FakeServer } from '../src/testing/fakeServer.js';
import { advanceWallClock, makeClient, settle, textsOf } from './helpers.js';

/**
 * Two real SyncEngine instances driving one server that implements the same
 * merge rules as the SQL function.
 *
 * These are the tests that matter most. Everything the user asked about —
 * offline behaviour, reconnection, conflict resolution, race conditions,
 * duplicate operations, event ordering — is a statement about what two devices
 * end up believing, and that can only be tested with two of them.
 */

let server: FakeServer;

beforeEach(() => {
  server = new FakeServer();
});

/** Build two clients for the same user, with deliberately disagreeing clocks. */
async function twoDevices() {
  const phone = makeClient(server, { clockOffsetMs: 0 });
  const desktop = makeClient(server, { clockOffsetMs: 4_000 });
  await phone.engine.start();
  await desktop.engine.start();
  await settle();
  return { phone, desktop };
}

/** Push everything pending both ways until the two devices agree. */
async function syncBoth(a: SyncEngine, b: SyncEngine): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await a.syncNow();
    await b.syncNow();
    await settle();
  }
}

function versionsOf(engine: SyncEngine): string[] {
  return [...engine.getTasks(), ...engine.getDeletedTasks()]
    .map((t) => [t.id, t.text, t.completed, t.position, t.deletedAt].join('|'))
    .sort();
}

function expectConverged(a: SyncEngine, b: SyncEngine): void {
  expect(versionsOf(a)).toEqual(versionsOf(b));
}

describe('live propagation', () => {
  it('a task captured on one device appears on the other', async () => {
    const { phone, desktop } = await twoDevices();

    await phone.engine.capture('renew my passport');
    await syncBoth(phone.engine, desktop.engine);

    expect(textsOf(desktop.engine.getOpenTasks())).toEqual(['renew my passport']);
    expectConverged(phone.engine, desktop.engine);
  });

  it('an edit on one device updates the other', async () => {
    const { phone, desktop } = await twoDevices();
    const task = await phone.engine.capture('call electrician');
    await syncBoth(phone.engine, desktop.engine);

    await desktop.engine.setText(task!.id, 'call electrician about the fuse box');
    await syncBoth(phone.engine, desktop.engine);

    expect(phone.engine.getTask(task!.id)?.text).toBe('call electrician about the fuse box');
    expectConverged(phone.engine, desktop.engine);
  });

  it('completing on one device completes it everywhere, and undo travels back', async () => {
    const { phone, desktop } = await twoDevices();
    const task = await phone.engine.capture('book dentist');
    await syncBoth(phone.engine, desktop.engine);

    await desktop.engine.setCompleted(task!.id, true);
    await syncBoth(phone.engine, desktop.engine);
    expect(phone.engine.getOpenTasks()).toHaveLength(0);
    expect(phone.engine.getTask(task!.id)?.completed).toBe(true);

    await phone.engine.setCompleted(task!.id, false);
    await syncBoth(phone.engine, desktop.engine);
    expect(textsOf(desktop.engine.getOpenTasks())).toEqual(['book dentist']);
    expectConverged(phone.engine, desktop.engine);
  });

  it('a delete removes the task everywhere, and a restore brings it back everywhere', async () => {
    const { phone, desktop } = await twoDevices();
    const task = await phone.engine.capture('cancel subscription');
    await syncBoth(phone.engine, desktop.engine);

    await phone.engine.remove(task!.id);
    await syncBoth(phone.engine, desktop.engine);
    expect(desktop.engine.getTasks()).toHaveLength(0);
    expect(textsOf(desktop.engine.getDeletedTasks())).toEqual(['cancel subscription']);

    await desktop.engine.restore(task!.id);
    await syncBoth(phone.engine, desktop.engine);
    expect(textsOf(phone.engine.getOpenTasks())).toEqual(['cancel subscription']);
    expectConverged(phone.engine, desktop.engine);
  });

  it('a reorder on one device reproduces the same order on the other', async () => {
    const { phone, desktop } = await twoDevices();
    await phone.engine.capture('c');
    await phone.engine.capture('b');
    await phone.engine.capture('a');
    await syncBoth(phone.engine, desktop.engine);
    expect(textsOf(desktop.engine.getTasks())).toEqual(['a', 'b', 'c']);

    await phone.engine.moveToIndex(phone.engine.getTasks()[0]!.id, 2);
    await syncBoth(phone.engine, desktop.engine);

    expect(textsOf(desktop.engine.getTasks())).toEqual(['b', 'c', 'a']);
    expectConverged(phone.engine, desktop.engine);
  });
});

describe('offline and reconnection', () => {
  it('delivers a backlog of offline captures exactly once', async () => {
    const { phone, desktop } = await twoDevices();

    phone.remote.goOffline();
    await phone.engine.capture('one');
    await phone.engine.capture('two');
    await phone.engine.capture('three');
    await phone.engine.syncNow();
    expect(desktop.engine.getTasks()).toHaveLength(0);

    phone.remote.goOnline();
    await settle();
    await syncBoth(phone.engine, desktop.engine);

    expect(textsOf(desktop.engine.getOpenTasks()).sort()).toEqual(['one', 'three', 'two']);
    expect(server.snapshot('user-1')).toHaveLength(3);
    expectConverged(phone.engine, desktop.engine);
  });

  it('catches up on changes it missed while disconnected', async () => {
    const { phone, desktop } = await twoDevices();

    phone.remote.goOffline();
    await desktop.engine.capture('added while the phone was away');
    await syncBoth(desktop.engine, desktop.engine);
    expect(phone.engine.getTasks()).toHaveLength(0);

    phone.remote.goOnline();
    await settle();
    await syncBoth(phone.engine, desktop.engine);

    expect(textsOf(phone.engine.getOpenTasks())).toEqual(['added while the phone was away']);
    expectConverged(phone.engine, desktop.engine);
  });

  it('merges work done independently on both sides of a partition', async () => {
    const { phone, desktop } = await twoDevices();

    phone.remote.goOffline();
    desktop.remote.goOffline();
    await phone.engine.capture('from the phone');
    await desktop.engine.capture('from the desktop');
    await phone.engine.syncNow();
    await desktop.engine.syncNow();

    phone.remote.goOnline();
    desktop.remote.goOnline();
    await settle();
    await syncBoth(phone.engine, desktop.engine);

    expect(textsOf(phone.engine.getOpenTasks()).sort()).toEqual([
      'from the desktop',
      'from the phone',
    ]);
    expectConverged(phone.engine, desktop.engine);
  });

  it('does not resend an acknowledged change after a reconnect', async () => {
    const { phone, desktop } = await twoDevices();
    await phone.engine.capture('sent once');
    await syncBoth(phone.engine, desktop.engine);

    phone.remote.goOffline();
    phone.remote.goOnline();
    await settle();
    const pushesBefore = phone.remote.pushCount;
    await phone.engine.syncNow();

    expect(phone.remote.pushCount).toBe(pushesBefore);
    expect(server.snapshot('user-1')).toHaveLength(1);
  });
});

describe('conflict resolution', () => {
  it('keeps both changes when two devices edit different fields concurrently', async () => {
    const { phone, desktop } = await twoDevices();
    const task = await phone.engine.capture('original text');
    await syncBoth(phone.engine, desktop.engine);

    // Both go offline and change different things about the same task.
    phone.remote.goOffline();
    desktop.remote.goOffline();
    await phone.engine.setText(task!.id, 'text edited on the phone');
    await desktop.engine.setCompleted(task!.id, true);
    await phone.engine.syncNow();
    await desktop.engine.syncNow();

    phone.remote.goOnline();
    desktop.remote.goOnline();
    await settle();
    await syncBoth(phone.engine, desktop.engine);

    // Row-level last-write-wins would have discarded one of these.
    for (const engine of [phone.engine, desktop.engine]) {
      expect(engine.getTask(task!.id)?.text).toBe('text edited on the phone');
      expect(engine.getTask(task!.id)?.completed).toBe(true);
    }
    expectConverged(phone.engine, desktop.engine);
  });

  it('resolves same-field conflicts deterministically and identically on both devices', async () => {
    const { phone, desktop } = await twoDevices();
    const task = await phone.engine.capture('who wins');
    await syncBoth(phone.engine, desktop.engine);

    phone.remote.goOffline();
    desktop.remote.goOffline();
    await phone.engine.setText(task!.id, 'phone version');
    advanceWallClock(10_000);
    await desktop.engine.setText(task!.id, 'desktop version');
    await phone.engine.syncNow();
    await desktop.engine.syncNow();

    phone.remote.goOnline();
    desktop.remote.goOnline();
    await settle();
    await syncBoth(phone.engine, desktop.engine);

    // The later edit wins, and — the part that actually matters — both devices
    // and the server agree on which one that was.
    expect(desktop.engine.getTask(task!.id)?.text).toBe('desktop version');
    expect(phone.engine.getTask(task!.id)?.text).toBe('desktop version');
    expect(server.get(task!.id)?.text).toBe('desktop version');
    expectConverged(phone.engine, desktop.engine);
  });

  it('lets a later delete win over an earlier edit, without losing the edit', async () => {
    const { phone, desktop } = await twoDevices();
    const task = await phone.engine.capture('contested');
    await syncBoth(phone.engine, desktop.engine);

    phone.remote.goOffline();
    desktop.remote.goOffline();
    await phone.engine.setText(task!.id, 'edited, then deleted elsewhere');
    advanceWallClock(10_000);
    await desktop.engine.remove(task!.id);
    await phone.engine.syncNow();
    await desktop.engine.syncNow();

    phone.remote.goOnline();
    desktop.remote.goOnline();
    await settle();
    await syncBoth(phone.engine, desktop.engine);

    expect(phone.engine.getTasks()).toHaveLength(0);
    // Restoring must bring back the newer text, not the pre-edit version.
    await phone.engine.restore(task!.id);
    await syncBoth(phone.engine, desktop.engine);
    expect(desktop.engine.getTask(task!.id)?.text).toBe('edited, then deleted elsewhere');
    expectConverged(phone.engine, desktop.engine);
  });

  it('survives two devices reordering at the same time', async () => {
    const { phone, desktop } = await twoDevices();
    await phone.engine.capture('c');
    await phone.engine.capture('b');
    await phone.engine.capture('a');
    await syncBoth(phone.engine, desktop.engine);

    phone.remote.goOffline();
    desktop.remote.goOffline();
    await phone.engine.moveToIndex(phone.engine.getTasks()[0]!.id, 2);
    await desktop.engine.moveToIndex(desktop.engine.getTasks()[2]!.id, 0);
    await phone.engine.syncNow();
    await desktop.engine.syncNow();

    phone.remote.goOnline();
    desktop.remote.goOnline();
    await settle();
    await syncBoth(phone.engine, desktop.engine);

    // The exact winning order is not specified, but it must be one order and
    // both devices must show it, with every task still present.
    expect(phone.engine.getTasks()).toHaveLength(3);
    expectConverged(phone.engine, desktop.engine);
  });
});

describe('unreliable delivery', () => {
  it('is unaffected by duplicated realtime events', async () => {
    const { phone, desktop } = await twoDevices();
    desktop.remote.duplicateRealtime = true;

    await phone.engine.capture('delivered twice');
    await syncBoth(phone.engine, desktop.engine);

    expect(desktop.engine.getTasks()).toHaveLength(1);
    expectConverged(phone.engine, desktop.engine);
  });

  it('is unaffected by out-of-order delivery', async () => {
    const { phone, desktop } = await twoDevices();
    const task = await phone.engine.capture('v1');
    await syncBoth(phone.engine, desktop.engine);

    const v1 = phone.engine.getTask(task!.id)!;
    await phone.engine.setText(task!.id, 'v2');
    const v2 = phone.engine.getTask(task!.id)!;
    await phone.engine.setText(task!.id, 'v3');
    const v3 = phone.engine.getTask(task!.id)!;

    // Replay the versions backwards, straight into the client.
    desktop.remote.deliver([v3]);
    desktop.remote.deliver([v1]);
    desktop.remote.deliver([v2]);
    await settle();

    expect(desktop.engine.getTask(task!.id)?.text).toBe('v3');
  });

  it('re-applying an entire history in a shuffled order reaches the same state', async () => {
    const { phone, desktop } = await twoDevices();
    const a = await phone.engine.capture('alpha');
    const b = await phone.engine.capture('beta');
    await phone.engine.setCompleted(a!.id, true);
    await phone.engine.setText(b!.id, 'beta revised');
    await phone.engine.moveToIndex(b!.id, 0);
    await syncBoth(phone.engine, desktop.engine);

    const expected = versionsOf(desktop.engine);
    const history = [...phone.engine.getTasks(), ...phone.engine.getDeletedTasks()];
    for (let i = 0; i < 5; i++) {
      desktop.remote.deliver([...history].reverse());
      desktop.remote.deliver(history);
    }
    await settle();

    expect(versionsOf(desktop.engine)).toEqual(expected);
  });
});
