import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Task } from '../model/types.js';
import {
  AuthSyncError,
  PermanentSyncError,
  TransientSyncError,
  type PullResult,
  type RealtimeState,
  type RemoteAdapter,
} from '../sync/types.js';
import { fromRow, toRow, type TaskRow } from './rows.js';

/** How far back each delta pull reaches, to cover commit-order skew. */
const PULL_OVERLAP_MS = 3_000;

function rewind(iso: string, byMs: number): string {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? new Date(at - byMs).toISOString() : iso;
}

/**
 * The production RemoteAdapter.
 *
 * All writes go through the `push_tasks` SQL function rather than a plain
 * upsert, for three reasons: it applies per-field last-write-wins inside a
 * single statement, it stamps `user_id` from the session so a client cannot
 * write into another list, and it returns the winning row so a client that lost
 * a comparison corrects itself on the same round trip.
 */
export class SupabaseRemote implements RemoteAdapter {
  private userId: string | null = null;
  private channel: RealtimeChannel | null = null;
  private handlers: {
    onTasks: (tasks: Task[]) => void;
    onState: (state: RealtimeState) => void;
  } | null = null;

  constructor(private readonly client: SupabaseClient) {}

  getUserId(): string | null {
    return this.userId;
  }

  /**
   * Called by the auth layer on sign-in, sign-out, and user change. The
   * realtime filter is per-user, so the channel has to be rebuilt whenever the
   * identity does.
   */
  setUser(userId: string | null): void {
    if (this.userId === userId) return;
    this.userId = userId;
    if (this.handlers) this.openChannel();
  }

  async push(tasks: readonly Task[]): Promise<Task[]> {
    if (tasks.length === 0) return [];
    const { data, error } = await this.client.rpc('push_tasks', {
      batch: tasks.map(toRow),
    });
    if (error) throw classify(error);
    return ((data ?? []) as TaskRow[]).map(fromRow);
  }

  async pull(cursor: string | null, limit: number): Promise<PullResult> {
    let query = this.client
      .from('tasks')
      .select('*')
      .order('server_updated_at', { ascending: true })
      // Fetch one extra row purely to learn whether another page exists.
      .limit(limit + 1);

    // Ask for slightly more than we strictly need. A row's cursor value is
    // stamped when it is written, but it only becomes visible when its
    // transaction commits — so a row written just before our last cursor can
    // appear just after we read. Re-reading a few seconds of history closes
    // that window, and costs nothing because merges are idempotent.
    if (cursor) query = query.gt('server_updated_at', rewind(cursor, PULL_OVERLAP_MS));

    const { data, error } = await query;
    if (error) throw classify(error);

    const rows = (data ?? []) as TaskRow[];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      tasks: page.map(fromRow),
      cursor: last?.server_updated_at ?? cursor,
      hasMore,
    };
  }

  subscribe(handlers: {
    onTasks: (tasks: Task[]) => void;
    onState: (state: RealtimeState) => void;
  }): () => void {
    this.handlers = handlers;
    this.openChannel();
    return () => {
      this.handlers = null;
      this.closeChannel();
    };
  }

  private openChannel(): void {
    this.closeChannel();
    const handlers = this.handlers;
    const userId = this.userId;
    if (!handlers || !userId) return;

    handlers.onState('connecting');

    this.channel = this.client
      .channel(`tasks:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as TaskRow | undefined;
          // Deletes arrive as tombstone updates, so an empty `new` means a hard
          // delete (tombstone purge) and there is nothing to merge.
          if (!row?.id) return;
          handlers.onTasks([fromRow(row)]);
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') handlers.onState('connected');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          handlers.onState('disconnected');
        }
      });
  }

  private closeChannel(): void {
    if (!this.channel) return;
    void this.client.removeChannel(this.channel);
    this.channel = null;
  }
}

interface SupabaseErrorLike {
  message?: string;
  code?: string;
  status?: number;
  details?: string;
}

/**
 * Decide whether a failure is worth retrying.
 *
 * Getting this wrong is expensive in both directions: retrying a malformed
 * request forever blocks the whole queue, while giving up on a transient
 * network error loses the user's capture. Anything not recognised is treated as
 * transient, because keeping the data and trying again is the safer default for
 * an app standing in for someone's memory.
 */
export function classify(error: unknown): Error {
  const err = error as SupabaseErrorLike;
  const message = err?.message ?? String(error);
  const status = err?.status;
  const code = err?.code;

  if (status === 401 || status === 403 || code === 'PGRST301' || /jwt|token/i.test(message)) {
    return new AuthSyncError(message);
  }

  // fetch() rejects with a TypeError when the network is unreachable.
  if (error instanceof TypeError || /fetch|network|timeout|abort/i.test(message)) {
    return new TransientSyncError(message);
  }

  if (status === 429 || (typeof status === 'number' && status >= 500)) {
    return new TransientSyncError(message);
  }

  // 23514 = check constraint, 22001 = value too long, 23503 = FK violation.
  // These are our own bugs or corrupt input; retrying cannot help.
  if (code === '23514' || code === '22001' || code === '23503') {
    return new PermanentSyncError(`${message}${err.details ? ` (${err.details})` : ''}`);
  }

  if (typeof status === 'number' && status >= 400 && status < 500) {
    return new PermanentSyncError(message);
  }

  return new TransientSyncError(message);
}
