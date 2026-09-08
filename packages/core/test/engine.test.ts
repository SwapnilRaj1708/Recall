import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStorage } from '../src/storage/memory.js';
import { FakeServer } from '../src/testing/fakeServer.js';
import { ManualTimers, makeClient, settle, textsOf } from './helpers.js';

let server: FakeServer;

beforeEach(() => {
  server = new FakeServer();
});

describe('capture', () => {
  it('stores a task and shows it immediately', async () => {
    const { engine } = makeClient(server);
    await engine.start();

    const task = await engine.capture('renew my passport');

    expect(task).not.toBeNull();
    expect(textsOf(engine.getOpenTasks())).toEqual(['renew my passport']);
  });

  it('reaches the server on the next sync', async () => {
    const { engine } = makeClient(server);
    await engine.start();
    await engine.capture('renew my passport');
    await engine.syncNow();

    expect(textsOf(server.snapshot('user-1'))).toEqual(['renew my passport']);
    expect(engine.getStatus().pending).toBe(0);
  });

  it('ignores blank input so callers can pass raw text', async () => {
    const { engine } = makeClient(server);
    await engine.start();

    expect(await engine.capture('')).toBeNull();
    expect(await engine.capture('   \n  ')).toBeNull();
    expect(engine.getTasks()).toHaveLength(0);
  });

  it('normalises pasted text', async () => {
    const { engine } = makeClient(server);
    await engine.start();
    const task = await engine.capture('  call   the\nelectrician ');
    expect(task?.text).toBe('call the electrician');
  });

  it('puts the newest capture at the top, where the eye already is', async () => {
    const { engine } = makeClient(server);
    await engine.start();
    await engine.capture('first');
    await engine.capture('second');
    await engine.capture('third');

    expect(textsOf(engine.getOpenTasks())).toEqual(['third', 'second', 'first']);
  });

  it('is usable with no network at all', async () => {
    const { engine, remote } = makeClient(server);
    remote.goOffline();
    await engine.start();

    await engine.capture('works offline');

    expect(textsOf(engine.getOpenTasks())).toEqual(['works offline']);
    expect(engine.getStatus().pending).toBe(1);
  });
});

describe('editing', () => {
  it('changes text', async () => {
    const { engine } = makeClient(server);
    await engine.start();
    const task = await engine.capture('draft');
    await engine.setText(task!.id, 'final');
    expect(engine.getTask(task!.id)?.text).toBe('final');
  });

  it('refuses to blank out a task by editing', async () => {
    const { engine } = makeClient(server);
    await engine.start();
    const task = await engine.capture('keep me');
    expect(await engine.setText(task!.id, '   ')).toBeNull();
    expect(engine.getTask(task!.id)?.text).toBe('keep me');
  });

  it('completes and uncompletes, moving the task in and out of the open list', async () => {
    const { engine } = makeClient(server);
    await engine.start();
    const task = await engine.capture('buy milk');

    await engine.setCompleted(task!.id, true);
    expect(engine.getOpenTasks()).toHaveLength(0);
    expect(textsOf(engine.getCompletedTasks())).toEqual(['buy milk']);
    expect(engine.getTask(task!.id)?.completedAt).not.toBeNull();

    await engine.setCompleted(task!.id, false);
    expect(textsOf(engine.getOpenTasks())).toEqual(['buy milk']);
    expect(engine.getTask(task!.id)?.completedAt).toBeNull();
  });

  it('treats a no-op completion as a no-op, rather than queuing a pointless write', async () => {
    const { engine } = makeClient(server);
    await engine.start();
    const task = await engine.capture('x');
    await engine.syncNow();

    expect(await engine.setCompleted(task!.id, false)).toBeNull();
    expect(engine.getStatus().pending).toBe(0);
  });

  it('deletes into a recoverable tombstone and restores from it', async () => {
    const { engine } = makeClient(server);
    await engine.start();
    const task = await engine.capture('accidental');

    await engine.remove(task!.id);
    expect(engine.getTasks()).toHaveLength(0);
    expect(textsOf(engine.getDeletedTasks())).toEqual(['accidental']);

    await engine.restore(task!.id);
    expect(textsOf(engine.getOpenTasks())).toEqual(['accidental']);
  });

  it('ignores mutations to unknown ids', async () => {
    const { engine } = makeClient(server);
    await engine.start();
    expect(await engine.setText('nope', 'x')).toBeNull();
    expect(await engine.setCompleted('nope', true)).toBeNull();
    expect(await engine.remove('nope')).toBeNull();
    expect(await engine.restore('nope')).toBeNull();
  });
});

describe('reordering', () => {
  it('moves a task to an arbitrary index', async () => {
    const { engine } = makeClient(server);
    await engine.start();
    await engine.capture('c');
    await engine.capture('b');
    await engine.capture('a');
    expect(textsOf(engine.getTasks())).toEqual(['a', 'b', 'c']);

    const a = engine.getTasks()[0]!;
    await engine.moveToIndex(a.id, 2);
    expect(textsOf(engine.getTasks())).toEqual(['b', 'c', 'a']);

    await engine.moveToIndex(a.id, 0);
    expect(textsOf(engine.getTasks())).toEqual(['a', 'b', 'c']);
  });

  it('clamps an out-of-range index instead of corrupting the order', async () => {
    const { engine } = makeClient(server);
    await engine.start();
    await engine.capture('b');
    await engine.capture('a');

    const a = engine.getTasks()[0]!;
    await engine.moveToIndex(a.id, 99);
    expect(textsOf(engine.getTasks())).toEqual(['b', 'a']);
  });

  it('rewrites only the moved row, so a reorder is one small mutation', async () => {
    const { engine } = makeClient(server);
    await engine.start();
    await engine.capture('c');
    await engine.capture('b');
    await engine.capture('a');
    await engine.syncNow();

    const before = engine.getTasks().map((t) => `${t.id}:${t.position}`);
    await engine.moveToIndex(engine.getTasks()[0]!.id, 2);
    const after = engine.getTasks().map((t) => `${t.id}:${t.position}`);

    const changed = after.filter((entry) => !before.includes(entry));
    expect(changed).toHaveLength(1);
    expect(engine.getStatus().pending).toBe(1);
  });
});

describe('durability', () => {
  it('restores the list from cache after a restart, before any network call', async () => {
    const storage = new MemoryStorage();
    const first = makeClient(server, { storage });
    await first.engine.start();
    await first.engine.capture('survives restart');
    await first.engine.syncNow();
    first.engine.stop();

    // A fresh process, with the network unavailable, must still show the list.
    const second = makeClient(server, { storage });
    second.remote.goOffline();
    await second.engine.start();

    expect(textsOf(second.engine.getOpenTasks())).toEqual(['survives restart']);
  });

  it('keeps unsent captures across a crash and delivers them later', async () => {
    const storage = new MemoryStorage();
    const first = makeClient(server, { storage });
    first.remote.goOffline();
    await first.engine.start();
    await first.engine.capture('queued before the crash');

    // Simulate a hard kill: no stop(), no flush, just a new engine on the same store.
    const second = makeClient(server, { storage });
    await second.engine.start();
    await second.engine.syncNow();
    // start() kicks off its own sync, so let any in-flight flush finish before
    // reading the queue depth.
    await settle();

    expect(textsOf(server.snapshot('user-1'))).toEqual(['queued before the crash']);
    expect(second.engine.getStatus().pending).toBe(0);
  });

  it('reports a storage failure instead of pretending the task is safe', async () => {
    const storage = new MemoryStorage();
    storage.saveTasks = async () => {
      throw new Error('QuotaExceededError');
    };
    const { engine } = makeClient(server, { storage });
    await engine.start();
    await engine.capture('cannot persist');

    expect(engine.getStatus().error).toMatch(/local storage/i);
    // The task is still live in memory and queued, so it is not lost.
    expect(textsOf(engine.getOpenTasks())).toEqual(['cannot persist']);
    expect(engine.getStatus().pending).toBe(1);
  });
});

describe('failure handling', () => {
  it('queues through an outage and delivers everything exactly once on reconnect', async () => {
    const { engine, remote } = makeClient(server);
    await engine.start();

    remote.goOffline();
    await engine.capture('one');
    await engine.capture('two');
    await engine.capture('three');
    await engine.syncNow();

    expect(server.snapshot('user-1')).toHaveLength(0);
    expect(engine.getStatus().pending).toBe(3);
    expect(engine.getStatus().error).toBeTruthy();

    remote.goOnline();
    await settle();
    await engine.syncNow();

    expect(textsOf(server.snapshot('user-1')).sort()).toEqual(['one', 'three', 'two']);
    expect(engine.getStatus().pending).toBe(0);
    expect(engine.getStatus().error).toBeNull();
  });

  it('retries a repeated failure with growing backoff rather than hammering', async () => {
    const timers = new ManualTimers();
    const { engine, remote } = makeClient(server, { timers });
    await engine.start();
    remote.goOffline();

    await engine.capture('will retry');
    // A local change asks for an immediate attempt; running it is what produces
    // the first backoff delay.
    await timers.advance(0);

    // The soonest pending timer is the retry; the background poll is also
    // scheduled, but sits far enough out to filter off.
    const nextRetry = () => {
      const candidates = timers.scheduledDelays().filter((d) => d > 0 && d < 120_000);
      return candidates.length > 0 ? Math.min(...candidates) : undefined;
    };

    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      const next = nextRetry();
      if (next === undefined) break;
      delays.push(next);
      await timers.advance(next);
    }

    expect(delays.length).toBeGreaterThanOrEqual(3);
    expect(delays[1]!).toBeGreaterThan(delays[0]!);
    expect(delays[2]!).toBeGreaterThan(delays[1]!);
    expect(Math.max(...delays)).toBeLessThanOrEqual(60_000);
  });

  it('parks a permanently rejected change without blocking the queue behind it', async () => {
    const { engine, remote } = makeClient(server);
    await engine.start();

    remote.failureMode = 'permanent';
    await engine.capture('rejected');
    await engine.syncNow();

    expect(engine.getStatus().failed).toBe(1);
    expect(engine.getStatus().pending).toBe(0);

    // A later, valid capture must not be stuck behind the parked one.
    remote.failureMode = 'none';
    await engine.capture('accepted');
    await engine.syncNow();

    expect(textsOf(server.snapshot('user-1'))).toEqual(['accepted']);
    // The rejected change is kept, not discarded, so nothing is silently lost.
    expect(engine.getOutboxEntries().some((e) => e.status === 'failed')).toBe(true);
  });

  it('can retry parked changes on request', async () => {
    const { engine, remote } = makeClient(server);
    await engine.start();
    remote.failureMode = 'permanent';
    await engine.capture('temporarily rejected');
    await engine.syncNow();
    expect(engine.getStatus().failed).toBe(1);

    remote.failureMode = 'none';
    engine.retryFailed();
    await engine.syncNow();

    expect(textsOf(server.snapshot('user-1'))).toEqual(['temporarily rejected']);
    expect(engine.getStatus().failed).toBe(0);
  });

  it('holds the queue when the session expires and explains why', async () => {
    const { engine, remote } = makeClient(server);
    await engine.start();
    await engine.capture('written while signed in');

    remote.failureMode = 'auth';
    await engine.syncNow();

    expect(engine.getStatus().error).toMatch(/sign.?in/i);
    expect(engine.getStatus().pending).toBe(1);

    remote.failureMode = 'none';
    await engine.syncNow();
    expect(textsOf(server.snapshot('user-1'))).toEqual(['written while signed in']);
  });

  it('keeps captures made before signing in and sends them afterwards', async () => {
    const { engine, remote } = makeClient(server);
    remote.setUserId(null);
    await engine.start();

    await engine.capture('captured before sign-in');
    await engine.syncNow();
    expect(server.snapshot('user-1')).toHaveLength(0);
    expect(engine.getStatus().pending).toBe(1);

    remote.setUserId('user-1');
    await engine.syncNow();
    expect(textsOf(server.snapshot('user-1'))).toEqual(['captured before sign-in']);
  });
});

describe('subscriptions', () => {
  it('notifies listeners synchronously, before any await', async () => {
    const { engine } = makeClient(server);
    await engine.start();

    let notified = 0;
    engine.subscribe(() => notified++);

    const pending = engine.capture('instant');
    // The UI must already be able to see the task without awaiting persistence.
    expect(notified).toBeGreaterThan(0);
    expect(textsOf(engine.getOpenTasks())).toEqual(['instant']);
    await pending;
  });

  it('stops notifying after unsubscribe', async () => {
    const { engine } = makeClient(server);
    await engine.start();
    let notified = 0;
    const off = engine.subscribe(() => notified++);
    off();
    await engine.capture('quiet');
    expect(notified).toBe(0);
  });
});

describe('lifecycle', () => {
  it('is safe to start twice and stop twice', async () => {
    const { engine } = makeClient(server);
    await engine.start();
    await engine.start();
    engine.stop();
    engine.stop();
    expect(engine.getTasks()).toEqual([]);
  });

  it('does not sync after stop', async () => {
    const { engine, remote } = makeClient(server);
    await engine.start();
    engine.stop();
    const before = remote.pushCount;
    await engine.syncNow();
    expect(remote.pushCount).toBe(before);
  });
});

describe('tombstone upkeep', () => {
  it('drops expired tombstones from the local cache on startup', async () => {
    const storage = new MemoryStorage();
    const first = makeClient(server, { storage });
    await first.engine.start();
    const task = await first.engine.capture('long gone');
    await first.engine.remove(task!.id);
    // Drain the queue, so the restart is not simply re-sending the tombstone.
    await first.engine.syncNow();
    await settle();
    first.engine.stop();

    // Age the tombstone past the retention window.
    const aged = (await storage.loadTasks()).map((t) => ({
      ...t,
      deletedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    }));
    await storage.saveTasks(aged);

    const second = makeClient(server, { storage });
    // Offline, so the assertion is about local upkeep and not about what the
    // server happens to send back.
    second.remote.goOffline();
    await second.engine.start();
    await settle();

    expect(second.engine.getDeletedTasks()).toHaveLength(0);
    expect(await storage.loadTasks()).toHaveLength(0);
  });
});

describe('pull paging', () => {
  it('stops rather than spinning when a page does not advance the cursor', async () => {
    const { engine, remote } = makeClient(server);
    await engine.start();
    // start() kicks off its own sync; let it finish before swapping the remote,
    // or the pull below is skipped by the concurrency guard.
    await settle();

    // A server that always claims there is more, but never moves the cursor.
    // Delta pulls deliberately overlap the previous cursor to cover
    // commit-order skew, so this shape is reachable and must terminate.
    let calls = 0;
    remote.pull = async () => {
      calls++;
      return { tasks: [], cursor: 'stuck', hasMore: true };
    };

    await engine.syncNow();

    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThanOrEqual(2);
  });

  it('follows the cursor across multiple pages', async () => {
    const { engine, remote } = makeClient(server);
    await engine.start();
    await settle();

    const pages = [
      { tasks: [], cursor: 'a', hasMore: true },
      { tasks: [], cursor: 'b', hasMore: true },
      { tasks: [], cursor: 'c', hasMore: false },
    ];
    let index = 0;
    remote.pull = async () => pages[index++] ?? { tasks: [], cursor: 'c', hasMore: false };

    await engine.syncNow();

    expect(index).toBe(3);
  });
});

describe('network transitions', () => {
  it('does not leave the live indicator stuck off after a blip the socket survived', async () => {
    const { engine, remote } = makeClient(server);
    await engine.start();
    await settle();
    expect(engine.getStatus().live).toBe(true);

    // A browser offline/online pair where the websocket was never actually
    // dropped. Nothing will emit a fresh "connected", so the engine must not
    // have invented a disconnection of its own.
    engine.setOnline(false);
    expect(engine.getStatus().online).toBe(false);

    engine.setOnline(true);
    await settle();

    expect(engine.getStatus().online).toBe(true);
    expect(engine.getStatus().live).toBe(true);
    expect(remote.pushCount + remote.pullCount).toBeGreaterThan(0);
  });

  it('rebuilds a channel that really did drop', async () => {
    const { engine, remote } = makeClient(server);
    await engine.start();
    await settle();

    remote.goOffline(); // also drops the realtime channel
    engine.setOnline(false);
    await settle();
    expect(engine.getStatus().live).toBe(false);

    remote.failureMode = 'none';
    engine.setOnline(true);
    await settle();

    // The reconnect is driven by the engine, not by waiting for the transport
    // to notice on its own.
    expect(engine.getStatus().live).toBe(true);
  });

  it('reports offline without claiming anything about the channel', async () => {
    const { engine } = makeClient(server);
    await engine.start();
    await settle();

    engine.setOnline(false);
    const status = engine.getStatus();
    expect(status.online).toBe(false);
    // Captures must still work while offline.
    await engine.capture('written during the outage');
    expect(engine.getOpenTasks().map((t) => t.text)).toContain('written during the outage');
    expect(engine.getStatus().pending).toBeGreaterThan(0);

    engine.setOnline(true);
    await settle();
  });
});

describe('unresponsive local storage', () => {
  // An app whose entire purpose is capture must never answer a storage problem
  // with a spinner that never ends. IndexedDB has no cancellation and several
  // ways to block forever — a delete pending on another connection, a corrupt
  // store, a browser refusing to open it.

  const hangingStorage = (): MemoryStorage => {
    const storage = new MemoryStorage();
    storage.loadTasks = () => new Promise(() => {}); // never settles
    return storage;
  };

  it('still starts when the cache never responds', async () => {
    const storage = hangingStorage();
    const { engine } = makeClient(server, { storage });

    await engine.start();

    expect(engine.getStatus().error).toMatch(/local storage/i);
  });

  it('can still capture with the cache wedged', async () => {
    const storage = hangingStorage();
    const { engine } = makeClient(server, { storage });
    await engine.start();

    await engine.capture('captured while storage was stuck');

    expect(engine.getOpenTasks().map((t) => t.text)).toEqual([
      'captured while storage was stuck',
    ]);
  });

  it('still delivers to the server with the cache wedged', async () => {
    const storage = hangingStorage();
    const { engine } = makeClient(server, { storage });
    await engine.start();

    await engine.capture('reaches the server anyway');
    await engine.syncNow();
    await settle();

    expect(textsOf(server.snapshot('user-1'))).toEqual(['reaches the server anyway']);
  });

  it('reports a cache that rejects rather than hangs', async () => {
    const storage = new MemoryStorage();
    storage.loadTasks = async () => {
      throw new Error('InvalidStateError');
    };
    const { engine } = makeClient(server, { storage });

    await engine.start();

    expect(engine.getStatus().error).toMatch(/InvalidStateError/);
    await engine.capture('still works');
    expect(engine.getOpenTasks()).toHaveLength(1);
  });
});
