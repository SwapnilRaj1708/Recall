import { Clock } from '../src/model/clock.js';
import { MemoryStorage } from '../src/storage/memory.js';
import { SyncEngine } from '../src/sync/engine.js';
import type { Timers } from '../src/sync/engine.js';
import type { StorageAdapter } from '../src/storage/types.js';
import { FakeRemote, FakeServer } from '../src/testing/fakeServer.js';

/**
 * Timers that never fire.
 *
 * Most tests drive synchronisation explicitly with `syncNow()`, so the engine's
 * own retry and poll scheduling is switched off. That removes every source of
 * timing nondeterminism from tests whose subject is convergence, not timing.
 * The scheduling behaviour itself is covered separately with ManualTimers.
 */
export const inertTimers: Timers = {
  setTimeout: () => 0,
  clearTimeout: () => {},
};

/** A virtual clock for the tests that do care about retry scheduling. */
export class ManualTimers implements Timers {
  private queue = new Map<number, { fn: () => void; at: number }>();
  private nextHandle = 1;
  private now = 0;

  setTimeout(fn: () => void, ms: number): unknown {
    const handle = this.nextHandle++;
    this.queue.set(handle, { fn, at: this.now + Math.max(0, ms) });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') this.queue.delete(handle);
  }

  get pendingCount(): number {
    return this.queue.size;
  }

  /** Delays currently scheduled, relative to virtual now. */
  scheduledDelays(): number[] {
    return [...this.queue.values()].map((entry) => entry.at - this.now).sort((a, b) => a - b);
  }

  /** Advance virtual time, running callbacks in order and letting their promises settle. */
  async advance(ms: number): Promise<void> {
    const target = this.now + ms;
    let guard = 0;
    for (;;) {
      const due = [...this.queue.entries()]
        .filter(([, entry]) => entry.at <= target)
        .sort((a, b) => a[1].at - b[1].at);
      const next = due[0];
      if (!next || guard++ > 500) break;
      this.queue.delete(next[0]);
      this.now = next[1].at;
      next[1].fn();
      await settle();
    }
    this.now = target;
  }
}

/** Let every queued microtask and immediate callback run. */
export async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

export interface Harness {
  engine: SyncEngine;
  remote: FakeRemote;
  storage: StorageAdapter;
  clock: Clock;
}

let clockSeed = Date.UTC(2026, 0, 1, 12, 0, 0);

/**
 * Build a client wired to `server`.
 *
 * Each client gets its own clock offset so the tests exercise the realistic
 * case of two devices whose wall clocks do not agree, rather than the
 * artificially tidy case where they do.
 */
export function makeClient(
  server: FakeServer,
  options: {
    userId?: string;
    clockOffsetMs?: number;
    storage?: StorageAdapter;
    timers?: Timers;
    storageTimeoutMs?: number;
  } = {},
): Harness {
  const offset = options.clockOffsetMs ?? 0;
  let ticks = 0;
  const clock = new Clock(() => clockSeed + offset + ticks++ * 10);

  const storage = options.storage ?? new MemoryStorage();
  const remote = new FakeRemote(server, options.userId ?? 'user-1');
  const engine = new SyncEngine({
    storage,
    remote,
    clock,
    channelName: null, // No BroadcastChannel in Node; peers are simulated explicitly.
    timers: options.timers ?? inertTimers,
    // Short by default so the storage-timeout tests do not add real seconds.
    storageTimeoutMs: options.storageTimeoutMs ?? 50,
    random: () => 0.5,
  });

  return { engine, remote, storage, clock };
}

/** Advance the shared clock seed so a later client is unambiguously "after". */
export function advanceWallClock(ms: number): void {
  clockSeed += ms;
}

export function textsOf(tasks: { text: string }[]): string[] {
  return tasks.map((t) => t.text);
}
