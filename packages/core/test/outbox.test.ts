import { beforeEach, describe, expect, it } from 'vitest';
import { Clock } from '../src/model/clock.js';
import { createTask, withText } from '../src/model/task.js';
import { MemoryStorage } from '../src/storage/memory.js';
import { backoffDelay } from '../src/sync/backoff.js';
import { Outbox } from '../src/sync/outbox.js';
import { FakeServer } from '../src/testing/fakeServer.js';
import { makeClient, settle } from './helpers.js';

const BASE = Date.UTC(2026, 0, 1);
const at = (offset: number) => new Clock(() => BASE + offset);

describe('Outbox', () => {
  it('collapses repeated edits to one task into a single entry', async () => {
    const outbox = new Outbox(new MemoryStorage());
    let task = createTask('draft', 'a0', at(0));

    outbox.enqueue(task, task.updatedAt);
    for (let i = 1; i <= 20; i++) {
      task = withText(task, `draft ${i}`, at(i * 100));
      outbox.enqueue(task, task.updatedAt);
    }

    expect(outbox.size()).toBe(1);
    expect(outbox.pending()[0]?.snapshot.text).toBe('draft 20');
  });

  it('keeps the original queue time, so an edited item does not lose its place', () => {
    const outbox = new Outbox(new MemoryStorage());
    const task = createTask('first', 'a0', at(0));
    outbox.enqueue(task, '2026-01-01T00:00:00.000Z');
    outbox.enqueue(withText(task, 'edited', at(5_000)), '2026-01-01T00:05:00.000Z');

    expect(outbox.pending()[0]?.queuedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('sends captures in the order they were made', () => {
    const outbox = new Outbox(new MemoryStorage());
    const a = createTask('a', 'a0', at(0));
    const b = createTask('b', 'a1', at(1_000));
    outbox.enqueue(b, '2026-01-01T00:02:00.000Z');
    outbox.enqueue(a, '2026-01-01T00:01:00.000Z');

    expect(outbox.pending().map((e) => e.snapshot.text)).toEqual(['a', 'b']);
  });

  it('acknowledges only the exact version that was sent', () => {
    const outbox = new Outbox(new MemoryStorage());
    const task = createTask('original', 'a0', at(0));
    outbox.enqueue(task, task.updatedAt);

    // The user edits while the push is still in flight.
    const newer = withText(task, 'edited mid-flight', at(9_000));
    outbox.enqueue(newer, newer.updatedAt);

    // The acknowledgement is for the *old* version, so the entry must survive.
    outbox.ack([task]);

    expect(outbox.size()).toBe(1);
    expect(outbox.pending()[0]?.snapshot.text).toBe('edited mid-flight');

    outbox.ack([newer]);
    expect(outbox.size()).toBe(0);
  });

  it('parks an entry after enough consecutive failures, keeping its data', () => {
    const outbox = new Outbox(new MemoryStorage());
    const task = createTask('unlucky', 'a0', at(0));
    outbox.enqueue(task, task.updatedAt);

    for (let i = 0; i < 12; i++) outbox.recordFailure([task], 'network down');

    expect(outbox.failedCount()).toBe(1);
    expect(outbox.pendingCount()).toBe(0);
    expect(outbox.all()[0]?.snapshot.text).toBe('unlucky');
  });

  it('revives a parked entry when the user edits that task again', () => {
    const outbox = new Outbox(new MemoryStorage());
    const task = createTask('parked', 'a0', at(0));
    outbox.enqueue(task, task.updatedAt);
    outbox.markFailed([task], 'rejected');
    expect(outbox.failedCount()).toBe(1);

    outbox.enqueue(withText(task, 'edited again', at(5_000)), task.updatedAt);
    expect(outbox.pendingCount()).toBe(1);
    expect(outbox.failedCount()).toBe(0);
  });

  it('survives a reload from storage', async () => {
    const storage = new MemoryStorage();
    const first = new Outbox(storage);
    const task = createTask('persisted', 'a0', at(0));
    first.enqueue(task, task.updatedAt);
    await first.persist();

    const second = new Outbox(storage);
    await second.load();
    expect(second.pending()[0]?.snapshot.text).toBe('persisted');
  });
});

describe('backoffDelay', () => {
  it('grows exponentially and stops at one minute', () => {
    const fixed = { random: () => 0.5 };
    expect(backoffDelay(1, fixed)).toBe(1_000);
    expect(backoffDelay(2, fixed)).toBe(2_000);
    expect(backoffDelay(3, fixed)).toBe(4_000);
    expect(backoffDelay(20, fixed)).toBe(60_000);
  });

  it('spreads retries with jitter so clients do not retry in lockstep', () => {
    const low = backoffDelay(5, { random: () => 0 });
    const high = backoffDelay(5, { random: () => 1 });
    expect(low).toBeLessThan(high);
    expect(high - low).toBeGreaterThan(0);
  });

  it('never returns a negative delay', () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      expect(backoffDelay(attempt, { random: () => 0 })).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('mid-flight edits through the engine', () => {
  let server: FakeServer;

  beforeEach(() => {
    server = new FakeServer();
  });

  it('does not lose an edit made while its push was in flight', async () => {
    const { engine, remote } = makeClient(server);
    await engine.start();
    const task = await engine.capture('version one');

    // Hold the push open, edit the task, then let the push complete.
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realPush = remote.push.bind(remote);
    remote.push = async (tasks) => {
      await gate;
      return realPush(tasks);
    };

    const inFlight = engine.syncNow();
    await engine.setText(task!.id, 'version two');
    release!();
    await inFlight;

    remote.push = realPush;
    await engine.syncNow();
    await settle();

    expect(server.get(task!.id)?.text).toBe('version two');
    expect(engine.getStatus().pending).toBe(0);
  });
});

describe('a queue shared by two windows', () => {
  // The desktop app runs the widget and the main window as separate JavaScript
  // contexts over one IndexedDB, so they share this queue. A blind overwrite
  // would let one window's capture delete the other's — and because the task
  // itself is in the task store, it would look saved while never syncing.

  it('does not drop an entry queued by the other window', async () => {
    const shared = new MemoryStorage();
    const widget = new Outbox(shared);
    const mainWindow = new Outbox(shared);
    await widget.load();
    await mainWindow.load();

    const fromWidget = createTask('captured in the widget', 'a0', at(0));
    widget.enqueue(fromWidget, fromWidget.updatedAt);
    await widget.persist();

    // The main window still has an empty in-memory queue — it has not heard
    // about the widget's capture yet — and now queues one of its own.
    const fromMain = createTask('captured in the main window', 'a1', at(1_000));
    mainWindow.enqueue(fromMain, fromMain.updatedAt);
    await mainWindow.persist();

    const onDisk = await shared.loadOutbox();
    expect(onDisk.map((e) => e.snapshot.text).sort()).toEqual([
      'captured in the main window',
      'captured in the widget',
    ]);
  });

  it('still removes an entry it actually got accepted', async () => {
    const shared = new MemoryStorage();
    const outbox = new Outbox(shared);
    const task = createTask('accepted', 'a0', at(0));

    outbox.enqueue(task, task.updatedAt);
    await outbox.persist();
    expect(await shared.loadOutbox()).toHaveLength(1);

    outbox.ack([task]);
    await outbox.persist();
    expect(await shared.loadOutbox()).toHaveLength(0);
  });

  it('keeps a newer version queued elsewhere while our push was in flight', async () => {
    const shared = new MemoryStorage();
    const pusher = new Outbox(shared);
    const other = new Outbox(shared);

    const original = createTask('v1', 'a0', at(0));
    pusher.enqueue(original, original.updatedAt);
    await pusher.persist();

    // The other window edits the same task while our push is in flight.
    await other.load();
    const edited = withText(original, 'v2', at(9_000));
    other.enqueue(edited, edited.updatedAt);
    await other.persist();

    // Our push of v1 comes back accepted. v2 must survive.
    pusher.ack([original]);
    await pusher.persist();

    const onDisk = await shared.loadOutbox();
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0]?.snapshot.text).toBe('v2');
  });

  it('two engines over one store deliver every capture exactly once', async () => {
    const server = new FakeServer();
    const shared = new MemoryStorage();
    const a = makeClient(server, { storage: shared });
    const b = makeClient(server, { storage: shared });

    a.remote.goOffline();
    b.remote.goOffline();
    await a.engine.start();
    await b.engine.start();

    await a.engine.capture('from the widget');
    await b.engine.capture('from the main window');

    a.remote.goOnline();
    b.remote.goOnline();
    await settle();
    for (let i = 0; i < 3; i++) {
      await a.engine.syncNow();
      await b.engine.syncNow();
      await settle();
    }

    const texts = server.snapshot('user-1').map((t) => t.text).sort();
    expect(texts).toEqual(['from the main window', 'from the widget']);
  });
});
