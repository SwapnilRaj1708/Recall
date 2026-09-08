import { Clock, clock as defaultClock } from '../model/clock.js';
import { compareByPosition, positionBetween, positionForNewCapture } from '../model/fracIndex.js';
import { mergeAll } from '../model/merge.js';
import {
  createTask,
  isActive,
  isBlank,
  isOpen,
  isPurgeableTombstone,
  withCompleted,
  withDeleted,
  withPosition,
  withText,
} from '../model/task.js';
import type { SyncStatus, Task } from '../model/types.js';
import { META_CURSOR, META_LAST_SYNCED, type StorageAdapter } from '../storage/types.js';
import { backoffDelay } from './backoff.js';
import { Outbox } from './outbox.js';
import {
  AuthSyncError,
  PermanentSyncError,
  type RealtimeState,
  type RemoteAdapter,
} from './types.js';

export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface SyncEngineOptions {
  storage: StorageAdapter;
  remote: RemoteAdapter;
  clock?: Clock;
  /** Peer-window notification channel. Pass null to disable. */
  channelName?: string | null;
  /** Safety-net poll, for when a realtime channel dies without saying so. */
  pullIntervalMs?: number;
  /**
   * Open a live change feed. Off in the extension's service worker, which is
   * killed after a few seconds of idleness — a websocket there would be torn
   * down before it delivered anything, while still costing a connection.
   */
  realtime?: boolean;
  pushBatchSize?: number;
  pullPageSize?: number;
  /** How long any one local-storage read may take at startup before it is abandoned. */
  storageTimeoutMs?: number;
  timers?: Timers;
  random?: () => number;
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * The single source of task behaviour for every surface.
 *
 * Local-first by construction: a mutation updates memory and notifies the UI
 * before anything touches the network, then persists, then queues for the
 * server. Nothing the user does blocks on connectivity, and nothing they do is
 * lost if connectivity never returns.
 */
export class SyncEngine {
  private readonly storage: StorageAdapter;
  private readonly remote: RemoteAdapter;
  private readonly clock: Clock;
  private readonly outbox: Outbox;
  private readonly timers: Timers;
  private readonly random: () => number;
  private readonly pullIntervalMs: number;
  private readonly pushBatchSize: number;
  private readonly pullPageSize: number;
  private readonly channelName: string | null;
  private readonly realtimeEnabled: boolean;
  private readonly storageTimeoutMs: number;

  private tasks = new Map<string, Task>();
  private listeners = new Set<() => void>();
  private channel: BroadcastChannel | null = null;
  private unwatchStorage: (() => void) | null = null;
  private unsubscribeRemote: (() => void) | null = null;

  /**
   * Bumped on every observable change. React subscribes to this rather than to
   * the task arrays, which are rebuilt on each read and so would look different
   * every time to a `useSyncExternalStore` snapshot comparison.
   */
  private version = 0;

  private started = false;
  private readonly readyPromise: Promise<void>;
  private markReady: () => void = () => {};
  private flushing = false;
  private pulling = false;
  private consecutiveFailures = 0;
  private retryHandle: unknown = null;
  private pollHandle: unknown = null;
  private cursor: string | null = null;
  private realtime: RealtimeState = 'disconnected';

  private status: SyncStatus = {
    online: true,
    live: false,
    syncing: false,
    pending: 0,
    failed: 0,
    lastSyncedAt: null,
    error: null,
  };

  constructor(options: SyncEngineOptions) {
    this.storage = options.storage;
    this.remote = options.remote;
    this.clock = options.clock ?? defaultClock;
    this.timers = options.timers ?? defaultTimers;
    this.random = options.random ?? Math.random;
    this.pullIntervalMs = options.pullIntervalMs ?? 120_000;
    this.pushBatchSize = options.pushBatchSize ?? 100;
    this.pullPageSize = options.pullPageSize ?? 500;
    this.channelName = options.channelName === undefined ? 'recall-sync' : options.channelName;
    this.realtimeEnabled = options.realtime ?? true;
    this.storageTimeoutMs = options.storageTimeoutMs ?? STORAGE_TIMEOUT_MS;
    this.outbox = new Outbox(this.storage);
    this.status.online = readOnline();
    this.readyPromise = new Promise((resolve) => {
      this.markReady = resolve;
    });
  }

  /**
   * Resolves once the local cache has been read into memory.
   *
   * `start()` cannot be awaited for this: it sets `started` synchronously, so a
   * second caller returns immediately while the load is still in flight. That
   * matters for anything replaying work against tasks that already exist —
   * the Android widget's queue applies edits and deletions by id, and an id the
   * engine has not loaded yet simply does not resolve, so the operation is
   * dropped without a word.
   */
  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * Tasks whose current version has not reached the server yet.
   *
   * The outbox already knows this — it is what the "n pending" badge counts —
   * but a count cannot tell you *which* rows are still local. Surfaces use this
   * to mark them, so a capture made offline, or replayed from the home-screen
   * widget, is visibly not-yet-safe rather than indistinguishable from a task
   * that has been on the server for a week.
   */
  getUnsyncedIds(): ReadonlySet<string> {
    return new Set(this.outbox.all().map((entry) => entry.taskId));
  }

  // ---------------------------------------------------------------- lifecycle

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // Reading the cache must never be able to hold the app hostage. IndexedDB
    // can block indefinitely — a delete pending on another connection, a
    // corrupt store, a browser refusing to open it — and an app that exists to
    // capture thoughts cannot answer that with a spinner that never ends. If
    // the cache does not arrive promptly we start empty, say so, and let the
    // server refill the list.
    let stored: Task[] = [];
    try {
      stored = await withTimeout(this.storage.loadTasks(), this.storageTimeoutMs, 'load tasks');
      await withTimeout(this.outbox.load(), this.storageTimeoutMs, 'load the outbox');
    } catch (error) {
      this.setError(
        `Local storage is not responding (${describe(error)}). Your list will reload from the server, and anything you capture now is kept in memory until it does.`,
      );
    }

    // The cache is authoritative for what the user sees at startup, so the list
    // is on screen before any network call is attempted.
    mergeAll(this.tasks, stored);
    for (const task of this.tasks.values()) this.clock.observe(task.updatedAt);
    // Released here rather than at the end of start(): everything below is
    // network setup, and a waiter only needs the local list to be present.
    // Reached even when loading failed, so a broken cache cannot hang a caller.
    this.markReady();


    try {
      this.cursor = await withTimeout(
        this.storage.getMeta<string>(META_CURSOR),
        this.storageTimeoutMs,
        'read the sync cursor',
      );
      this.status.lastSyncedAt = await withTimeout(
        this.storage.getMeta<string>(META_LAST_SYNCED),
        this.storageTimeoutMs,
        'read the sync time',
      );
    } catch {
      // A missing cursor just means the next pull fetches everything.
      this.cursor = null;
    }
    this.refreshCounts();
    this.notify();

    await this.purgeOldTombstones();

    this.attachPeerChannel();
    this.attachNetworkListeners();
    this.connectRealtime();
    this.scheduleNextPoll();

    void this.syncNow();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.timers.clearTimeout(this.retryHandle);
    this.timers.clearTimeout(this.pollHandle);
    this.retryHandle = null;
    this.pollHandle = null;
    this.unsubscribeRemote?.();
    this.unsubscribeRemote = null;
    this.unwatchStorage?.();
    this.unwatchStorage = null;
    this.detachNetworkListeners();
    this.channel?.close();
    this.channel = null;
    this.storage.close?.();
  }

  // ------------------------------------------------------------------ reading

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Everything not deleted, in list order. */
  getTasks(): Task[] {
    return [...this.tasks.values()].filter(isActive).sort(compareByPosition);
  }

  /** Not deleted and not completed — what the widget shows. */
  getOpenTasks(): Task[] {
    return [...this.tasks.values()].filter(isOpen).sort(compareByPosition);
  }

  getCompletedTasks(): Task[] {
    return [...this.tasks.values()]
      .filter((t) => isActive(t) && t.completed)
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  }

  /** Tombstones still inside the retention window, newest first. */
  getDeletedTasks(): Task[] {
    return [...this.tasks.values()]
      .filter((t) => !isActive(t))
      .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  getOutboxEntries() {
    return this.outbox.all();
  }

  // ---------------------------------------------------------------- mutations

  /**
   * The primary entry point for the whole product: turn a thought into a stored
   * task. Blank input returns null so every caller can pass raw text without
   * pre-validating it.
   */
  /**
   * `id` is for replaying a capture made somewhere the engine could not reach —
   * see `createTask`. A capture whose id is already known is a no-op, which is
   * what makes replaying a queue safe.
   */
  async capture(text: string, id?: string): Promise<Task | null> {
    if (isBlank(text)) return null;
    if (id !== undefined && this.tasks.has(id)) return null;
    const task = createTask(text, positionForNewCapture(this.getTasks()), this.clock, id);
    return this.applyLocal(task);
  }

  async setText(id: string, text: string): Promise<Task | null> {
    const current = this.tasks.get(id);
    if (!current || isBlank(text)) return null;
    return this.applyLocal(withText(current, text, this.clock));
  }

  async setCompleted(id: string, completed: boolean): Promise<Task | null> {
    const current = this.tasks.get(id);
    if (!current || current.completed === completed) return null;
    return this.applyLocal(withCompleted(current, completed, this.clock));
  }

  async remove(id: string): Promise<Task | null> {
    const current = this.tasks.get(id);
    if (!current || !isActive(current)) return null;
    return this.applyLocal(withDeleted(current, true, this.clock));
  }

  async restore(id: string): Promise<Task | null> {
    const current = this.tasks.get(id);
    if (!current || isActive(current)) return null;
    return this.applyLocal(withDeleted(current, false, this.clock));
  }

  /**
   * Move a task to sit between two others. Callers pass neighbour ids rather
   * than an index, so the result stays correct even if the list shifted under
   * the drag because another device changed it mid-gesture.
   */
  async moveBetween(
    id: string,
    beforeId: string | null,
    afterId: string | null,
  ): Promise<Task | null> {
    const current = this.tasks.get(id);
    if (!current) return null;
    const before = beforeId ? (this.tasks.get(beforeId)?.position ?? null) : null;
    const after = afterId ? (this.tasks.get(afterId)?.position ?? null) : null;
    if (before !== null && after !== null && before >= after) return null;
    return this.applyLocal(withPosition(current, positionBetween(before, after), this.clock));
  }

  /** Move `id` to `targetIndex` within the currently visible ordering. */
  async moveToIndex(
    id: string,
    targetIndex: number,
    visible: Task[] = this.getTasks(),
  ): Promise<Task | null> {
    const without = visible.filter((t) => t.id !== id);
    const index = Math.max(0, Math.min(targetIndex, without.length));
    const before = index > 0 ? (without[index - 1] ?? null) : null;
    const after = without[index] ?? null;
    return this.moveBetween(id, before?.id ?? null, after?.id ?? null);
  }

  /**
   * Apply a local change: memory and UI first, durability second, network last.
   * The synchronous portion runs before the first await, so the UI never renders
   * a frame without the change in it.
   */
  private async applyLocal(task: Task): Promise<Task> {
    this.tasks.set(task.id, task);
    this.outbox.enqueue(task, this.clock.now());
    this.refreshCounts();
    this.notify();

    try {
      await this.storage.saveTasks([task]);
      await this.outbox.persist();
    } catch (error) {
      // Persistence failed — quota, private mode, a locked database. The change
      // is still live in memory and queued for the server, so report the
      // degraded state rather than implying the task is safely on disk.
      this.setError(`Could not write to local storage: ${describe(error)}`);
    }

    this.broadcast();
    this.scheduleFlush(0);
    return task;
  }

  // ------------------------------------------------------------------ syncing

  /** Push what is queued, then pull what is new. Safe to call at any time. */
  async syncNow(): Promise<void> {
    await this.flush();
    await this.pull();
  }

  private scheduleFlush(delayMs: number): void {
    if (!this.started) return;
    this.timers.clearTimeout(this.retryHandle);
    this.retryHandle = this.timers.setTimeout(() => {
      this.retryHandle = null;
      void this.flush();
    }, delayMs);
  }

  private async flush(): Promise<void> {
    if (!this.started || this.flushing) return;
    // Signed out: hold the queue rather than dropping it. Captures made before
    // signing in still reach the server afterwards.
    if (!this.remote.getUserId()) return;

    const batch = this.outbox.pending(this.pushBatchSize);
    if (batch.length === 0) {
      this.consecutiveFailures = 0;
      return;
    }

    this.flushing = true;
    this.setSyncing(true);
    const sent = batch.map((entry) => entry.snapshot);

    try {
      const winners = await this.remote.push(sent);
      this.outbox.ack(sent);
      // The server returns the winning version of every submitted row, so a
      // field that lost a comparison is corrected here instead of lingering as
      // a divergent local value.
      this.integrate(winners);
      this.consecutiveFailures = 0;
      await this.markSynced();
      await this.outbox.persist();

      // Drain the remainder immediately rather than waiting for a poll tick.
      if (this.outbox.pendingCount() > 0) this.scheduleFlush(0);
    } catch (error) {
      await this.handleSyncFailure(error, sent);
    } finally {
      this.flushing = false;
      this.setSyncing(false);
      this.refreshCounts();
      this.notify();
    }
  }

  private async pull(): Promise<void> {
    if (!this.started || this.pulling) return;
    if (!this.remote.getUserId()) return;

    this.pulling = true;
    this.setSyncing(true);
    try {
      let cursor = this.cursor;
      let hasMore = true;
      let guard = 0;
      while (hasMore && guard++ < 100) {
        const previous = cursor;
        const page = await this.remote.pull(cursor, this.pullPageSize);
        if (page.tasks.length > 0) this.integrate(page.tasks);
        if (page.cursor) cursor = page.cursor;
        // A page that does not move the cursor forward would be requested
        // again identically, so stop rather than spin. This can happen when a
        // pull deliberately overlaps the previous one to cover commit-order
        // skew, and it must not turn into a loop.
        hasMore = page.hasMore && cursor !== previous;
      }
      if (cursor !== this.cursor) {
        this.cursor = cursor;
        await this.storage.setMeta(META_CURSOR, cursor);
      }
      this.consecutiveFailures = 0;
      await this.markSynced();
    } catch (error) {
      await this.handleSyncFailure(error, []);
    } finally {
      this.pulling = false;
      this.setSyncing(false);
      this.notify();
    }
  }

  private async handleSyncFailure(error: unknown, sent: readonly Task[]): Promise<void> {
    const message = describe(error);

    if (error instanceof PermanentSyncError) {
      // The request itself is invalid, so retrying forever would only block
      // everything behind it. Park these entries — the data stays in the outbox
      // and is surfaced to the user — and keep the queue moving.
      this.outbox.markFailed(sent, message);
      await this.outbox.persist();
      this.setError(`Server rejected a change: ${message}`);
      this.scheduleFlush(0);
      return;
    }

    this.outbox.recordFailure(sent, message);
    await this.outbox.persist();
    this.consecutiveFailures++;

    if (error instanceof AuthSyncError) {
      this.setError('Sign-in expired. Your changes are saved and will sync when you sign in again.');
    } else {
      this.setError(message);
    }

    this.scheduleFlush(backoffDelay(this.consecutiveFailures, { random: this.random }));
  }

  /** Fold remote versions into local state and tell the UI what actually changed. */
  private integrate(incoming: readonly Task[]): void {
    if (incoming.length === 0) return;
    const changed = mergeAll(this.tasks, incoming);
    for (const task of incoming) this.clock.observe(task.updatedAt);
    if (changed.length === 0) return;

    void this.storage.saveTasks(changed).catch(() => {
      this.setError('Could not cache the latest changes locally.');
    });
    this.refreshCounts();
    this.notify();
    this.broadcast();
  }

  private async markSynced(): Promise<void> {
    const at = new Date().toISOString();
    this.status = { ...this.status, lastSyncedAt: at, error: null };
    await this.storage.setMeta(META_LAST_SYNCED, at);
  }

  // ----------------------------------------------------------------- realtime

  private connectRealtime(): void {
    if (!this.realtimeEnabled) return;
    this.unsubscribeRemote?.();
    this.unsubscribeRemote = this.remote.subscribe({
      onTasks: (tasks) => this.integrate(tasks),
      onState: (state) => {
        const reconnected = this.realtime !== 'connected' && state === 'connected';
        this.realtime = state;
        this.status = { ...this.status, live: state === 'connected' };
        this.notify();
        // A channel that dropped may have missed changes while it was down, so
        // close the gap with a delta pull instead of trusting the stream to
        // have been continuous.
        if (reconnected) void this.syncNow();
      },
    });
  }

  private scheduleNextPoll(): void {
    if (!this.started) return;
    this.pollHandle = this.timers.setTimeout(() => {
      this.pollHandle = null;
      void this.syncNow().finally(() => this.scheduleNextPoll());
    }, this.pullIntervalMs);
  }

  // -------------------------------------------------------- peers and network

  /**
   * Two Tauri windows, several browser tabs, and the extension's popup and
   * service worker all share one local store. Telling peers directly means an
   * edit in the widget lands in the main window in the same frame, rather than
   * waiting for a server round trip.
   */
  private attachPeerChannel(): void {
    this.unwatchStorage = this.storage.watch?.(() => void this.reloadFromStorage()) ?? null;

    if (this.channelName && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(this.channelName);
      this.channel.addEventListener('message', () => void this.reloadFromStorage());
    }
  }

  private broadcast(): void {
    this.channel?.postMessage({ at: Date.now() });
    const storage = this.storage as StorageAdapter & { notifyPeers?: () => void };
    storage.notifyPeers?.();
  }

  private async reloadFromStorage(): Promise<void> {
    try {
      const stored = await this.storage.loadTasks();
      // Merge rather than replace: this window may hold newer unpushed edits
      // that are not in the shared store yet.
      mergeAll(this.tasks, stored);
      await this.outbox.load();
      this.refreshCounts();
      this.notify();
    } catch {
      // A peer notification we cannot service is not worth surfacing to the user.
    }
  }

  /**
   * Report a connectivity change.
   *
   * Wired to the browser's `online`/`offline` events, but public because it is
   * the honest shape of the thing: a host that knows better — a desktop shell
   * watching the OS, say — can report connectivity directly, and tests can
   * drive it without a DOM.
   */
  setOnline(online: boolean): void {
    if (this.status.online === online) return;

    if (!online) {
      // Only `online` is asserted here. Whether the realtime channel is up is
      // the channel's own business to report: clobbering `live` from here
      // would leave it stuck false forever whenever the socket survives the
      // blip, because nothing would ever emit a fresh "connected" to undo it.
      // The badge already shows "Offline" ahead of any live state, so there is
      // nothing to gain by claiming a disconnection we have not observed.
      this.status = { ...this.status, online: false };
      this.notify();
      return;
    }

    this.status = { ...this.status, online: true };
    this.notify();
    this.consecutiveFailures = 0;

    // A real outage usually kills the websocket, but not always — and a channel
    // that died quietly never reports it. Rebuilding whenever we are not
    // demonstrably connected is cheap, and removes the failure mode where sync
    // silently degrades to polling for the rest of the session.
    if (this.realtime !== 'connected') this.connectRealtime();

    void this.syncNow();
  }

  private onlineHandler = (): void => this.setOnline(true);
  private offlineHandler = (): void => this.setOnline(false);

  private attachNetworkListeners(): void {
    if (typeof globalThis.addEventListener !== 'function') return;
    globalThis.addEventListener('online', this.onlineHandler);
    globalThis.addEventListener('offline', this.offlineHandler);
  }

  private detachNetworkListeners(): void {
    if (typeof globalThis.removeEventListener !== 'function') return;
    globalThis.removeEventListener('online', this.onlineHandler);
    globalThis.removeEventListener('offline', this.offlineHandler);
  }

  // ------------------------------------------------------------------- upkeep

  /** Drop tombstones past the retention window so the cache cannot grow forever. */
  private async purgeOldTombstones(): Promise<void> {
    const stale = [...this.tasks.values()].filter((task) => isPurgeableTombstone(task));
    if (stale.length === 0) return;
    for (const task of stale) this.tasks.delete(task.id);
    await this.storage.deleteTasks(stale.map((task) => task.id));
  }

  /** Re-queue entries the server refused, after the user asks to try again. */
  retryFailed(): void {
    this.outbox.retryFailed();
    this.consecutiveFailures = 0;
    this.refreshCounts();
    this.notify();
    this.scheduleFlush(0);
  }

  private refreshCounts(): void {
    this.status = {
      ...this.status,
      pending: this.outbox.pendingCount(),
      failed: this.outbox.failedCount(),
    };
  }

  private setSyncing(syncing: boolean): void {
    if (this.status.syncing === syncing) return;
    this.status = { ...this.status, syncing };
    this.notify();
  }

  private setError(error: string | null): void {
    if (this.status.error === error) return;
    this.status = { ...this.status, error };
    this.notify();
  }

  private notify(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  /** Monotonic change counter, for `useSyncExternalStore`. */
  getVersion(): number {
    return this.version;
  }

  /**
   * Forget everything held locally. Used on sign-out so a signed-out machine
   * does not keep a readable copy of the list.
   */
  async reset(): Promise<void> {
    const ids = [...this.tasks.keys()];
    this.tasks.clear();
    this.cursor = null;
    this.status = { ...this.status, lastSyncedAt: null, error: null, pending: 0, failed: 0 };
    await this.storage.deleteTasks(ids);
    await this.storage.saveOutbox([]);
    await this.storage.setMeta(META_CURSOR, null);
    await this.storage.setMeta(META_LAST_SYNCED, null);
    await this.outbox.load();
    this.notify();
    this.broadcast();
  }

  /** True when work is queued that has not reached the server yet. */
  hasUnsyncedWork(): boolean {
    return this.outbox.size() > 0;
  }
}

/** Default bound on any single local-storage operation. Overridable for tests. */
const STORAGE_TIMEOUT_MS = 4_000;

/**
 * Reject rather than hang.
 *
 * IndexedDB has no cancellation and several ways to block forever, so every
 * startup read is bounded. The alternative is an application that silently
 * never finishes loading.
 */
function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out trying to ${what}`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function readOnline(): boolean {
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  return nav?.onLine ?? true;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
