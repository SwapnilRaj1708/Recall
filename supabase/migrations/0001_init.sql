-- Recall — initial schema.
--
-- Paste this whole file into the Supabase SQL Editor and run it once.
-- It is written to be idempotent, so re-running it is harmless.
--
-- Design notes worth knowing before changing anything here:
--
--   * Every mutable field carries its own logical clock. Merging per field is
--     what stops a device that was offline from clobbering an unrelated edit
--     made elsewhere. Row-level last-write-wins would be simpler and wrong.
--
--   * Deletes are tombstones. A hard delete cannot replicate — the other
--     devices would simply never hear about it — and it cannot be undone.
--
--   * `push_tasks` is the only write path. It stamps `user_id` from the
--     session, so a client cannot write into anyone else's list even if it
--     tries, and it returns the winning row so a client that lost a merge
--     corrects itself on the same round trip.

-- =========================================================================
-- Table
-- =========================================================================

create table if not exists public.tasks (
  id                   uuid primary key,
  user_id              uuid not null references auth.users (id) on delete cascade,

  text                 text not null,
  completed            boolean not null default false,
  completed_at         timestamptz,
  -- Fractional index. Lexicographic order of this string is the list order,
  -- so moving one task rewrites exactly one field on one row.
  --
  -- COLLATE "C" is load-bearing: these keys are opaque character sequences
  -- compared with plain `<` in the clients, which is byte order. A linguistic
  -- collation would sort "a0" before "Zz" while every client sorts the other
  -- way, and the disagreement would surface as a silently wrong order rather
  -- than an error.
  position             text collate "C" not null,
  -- Non-null means deleted. Retained so the delete replicates and stays undoable.
  deleted_at           timestamptz,
  created_at           timestamptz not null default now(),

  -- Per-field logical clocks, supplied by the client and clamped on write.
  text_updated_at      timestamptz not null default now(),
  completed_updated_at timestamptz not null default now(),
  position_updated_at  timestamptz not null default now(),
  deleted_updated_at   timestamptz not null default now(),

  -- Derived by trigger from the four clocks above. Display only, never merged.
  updated_at           timestamptz not null default now(),

  -- Server-assigned sync cursor. Clients page through changes with this and
  -- never write it themselves.
  server_updated_at    timestamptz not null default clock_timestamp(),

  constraint tasks_text_length check (char_length(text) between 1 and 2000),
  constraint tasks_position_present check (char_length(position) between 1 and 200)
);

-- The delta-pull query: "my rows, changed since this cursor, oldest first".
create index if not exists tasks_user_server_updated_idx
  on public.tasks (user_id, server_updated_at);

-- Supports reading the list in order without a sort.
create index if not exists tasks_user_position_idx
  on public.tasks (user_id, position)
  where deleted_at is null;

-- Supports the tombstone purge without scanning live rows.
create index if not exists tasks_deleted_at_idx
  on public.tasks (deleted_at)
  where deleted_at is not null;

-- =========================================================================
-- Derived columns
-- =========================================================================

create or replace function public.tasks_before_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- `updated_at` is a summary of the field clocks, so it can never disagree
  -- with them or be spoofed by a client sending a stale value.
  new.updated_at := greatest(
    new.text_updated_at,
    new.completed_updated_at,
    new.position_updated_at,
    new.deleted_updated_at
  );

  -- clock_timestamp() rather than now(): now() is fixed for the whole
  -- transaction, so a multi-row push would give every row an identical cursor
  -- value and a page boundary landing inside that group would skip rows.
  new.server_updated_at := clock_timestamp();

  -- A completion timestamp on a task that is not complete is nonsense, and
  -- keeping the invariant here means no client can introduce it.
  if not new.completed then
    new.completed_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_before_write on public.tasks;
create trigger tasks_before_write
  before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

-- =========================================================================
-- Row-level security
-- =========================================================================
--
-- This is what makes it safe to ship the anon key inside the desktop app, the
-- extension and the web bundle: the key identifies the project, and these
-- policies are what actually restrict the data to its owner.

alter table public.tasks enable row level security;

drop policy if exists tasks_select_own on public.tasks;
create policy tasks_select_own on public.tasks
  for select using (auth.uid() = user_id);

drop policy if exists tasks_insert_own on public.tasks;
create policy tasks_insert_own on public.tasks
  for insert with check (auth.uid() = user_id);

drop policy if exists tasks_update_own on public.tasks;
create policy tasks_update_own on public.tasks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists tasks_delete_own on public.tasks;
create policy tasks_delete_own on public.tasks
  for delete using (auth.uid() = user_id);

-- =========================================================================
-- push_tasks — the only write path
-- =========================================================================

create or replace function public.push_tasks(batch jsonb)
returns setof public.tasks
language plpgsql
-- SECURITY INVOKER on purpose: the policies above still apply inside the
-- function, so a bug here cannot become a way around them.
security invoker
set search_path = public, pg_temp
as $$
declare
  uid       uuid := auth.uid();
  -- Clients supply their own clocks, so a device with a badly wrong system
  -- time could otherwise write a timestamp far in the future and win every
  -- future comparison. Clamping bounds the damage to five minutes.
  max_clock timestamptz := now() + interval '5 minutes';
  item      jsonb;
  saved     public.tasks;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if batch is null or jsonb_typeof(batch) <> 'array' then
    raise exception 'push_tasks expects a JSON array' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(batch) as t(value)
  loop
    insert into public.tasks as existing (
      id, user_id, text, completed, completed_at, position, deleted_at, created_at,
      text_updated_at, completed_updated_at, position_updated_at, deleted_updated_at
    )
    values (
      (item->>'id')::uuid,
      uid,
      left(coalesce(item->>'text', ''), 2000),
      coalesce((item->>'completed')::boolean, false),
      (item->>'completed_at')::timestamptz,
      coalesce(item->>'position', 'a0'),
      (item->>'deleted_at')::timestamptz,
      least(coalesce((item->>'created_at')::timestamptz, now()), max_clock),
      least(coalesce((item->>'text_updated_at')::timestamptz, now()), max_clock),
      least(coalesce((item->>'completed_updated_at')::timestamptz, now()), max_clock),
      least(coalesce((item->>'position_updated_at')::timestamptz, now()), max_clock),
      least(coalesce((item->>'deleted_updated_at')::timestamptz, now()), max_clock)
    )
    on conflict (id) do update set
      -- Each field moves only if the incoming clock is strictly newer. Strict
      -- comparison means an exact tie leaves the incumbent in place; the
      -- clients apply the identical rule, so everyone agrees.
      text = case
        when excluded.text_updated_at > existing.text_updated_at
        then excluded.text else existing.text end,
      text_updated_at = greatest(existing.text_updated_at, excluded.text_updated_at),

      -- `completed` and `completed_at` describe one state change and share a
      -- clock, so they must move together.
      completed = case
        when excluded.completed_updated_at > existing.completed_updated_at
        then excluded.completed else existing.completed end,
      completed_at = case
        when excluded.completed_updated_at > existing.completed_updated_at
        then excluded.completed_at else existing.completed_at end,
      completed_updated_at =
        greatest(existing.completed_updated_at, excluded.completed_updated_at),

      position = case
        when excluded.position_updated_at > existing.position_updated_at
        then excluded.position else existing.position end,
      position_updated_at =
        greatest(existing.position_updated_at, excluded.position_updated_at),

      deleted_at = case
        when excluded.deleted_updated_at > existing.deleted_updated_at
        then excluded.deleted_at else existing.deleted_at end,
      deleted_updated_at =
        greatest(existing.deleted_updated_at, excluded.deleted_updated_at),

      -- Creation is immutable, so the earliest claim is the honest one.
      created_at = least(existing.created_at, excluded.created_at)
    returning existing.* into saved;

    return next saved;
  end loop;
end;
$$;

revoke all on function public.push_tasks(jsonb) from public;
grant execute on function public.push_tasks(jsonb) to authenticated;

-- =========================================================================
-- Tombstone purge
-- =========================================================================

create or replace function public.purge_tombstones(older_than interval default '30 days')
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  removed integer;
begin
  delete from public.tasks
  where deleted_at is not null
    and deleted_at < now() - older_than;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_tombstones(interval) from public;
grant execute on function public.purge_tombstones(interval) to authenticated;

-- Optional: run the purge nightly. Requires the pg_cron extension, which is
-- available on Supabase but off by default (Database → Extensions → pg_cron).
-- Clients also purge their own local copies, so this is housekeeping, not
-- correctness — skip it if you would rather not enable the extension.
--
--   select cron.schedule(
--     'recall-purge-tombstones', '30 3 * * *',
--     $cron$ select public.purge_tombstones() $cron$
--   );

-- =========================================================================
-- Realtime
-- =========================================================================
--
-- Without this the clients still work — they fall back to delta polling — but
-- changes take up to two minutes to appear instead of arriving immediately.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
end;
$$;
