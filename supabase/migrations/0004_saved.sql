-- Recall — the Saved folder.
--
-- Paste this whole file into the Supabase SQL Editor and run it once, after
-- 0001–0003. It is idempotent, so re-running it is harmless.
--
-- A task can be saved: moved out of the working list into the Saved folder,
-- kept for later rather than finished or deleted. Like every other field it
-- has its own clock, so saving on one device and editing the text on another
-- while apart keeps both.
--
-- Run this before saving anything. Until it exists the server ignores the
-- saved state, so a task saved on one device stays saved there but shows in
-- the working list everywhere else.

alter table public.tasks
  add column if not exists saved_at timestamptz;

-- Existing rows have never been saved or unsaved: the epoch, so any real
-- choice made on a device wins over the absence of one.
alter table public.tasks
  add column if not exists saved_updated_at timestamptz not null
  default '1970-01-01T00:00:00Z';

-- =========================================================================
-- Derived columns: updated_at now covers the saved clock too
-- =========================================================================

create or replace function public.tasks_before_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := greatest(
    new.text_updated_at,
    new.completed_updated_at,
    new.position_updated_at,
    new.deleted_updated_at,
    new.saved_updated_at
  );

  new.server_updated_at := clock_timestamp();

  if not new.completed then
    new.completed_at := null;
  end if;

  return new;
end;
$$;

-- =========================================================================
-- push_tasks, with the saved field merged like the others
-- =========================================================================

create or replace function public.push_tasks(batch jsonb)
returns setof public.tasks
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  uid       uuid := auth.uid();
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
      id, user_id, text, completed, completed_at, position, deleted_at, saved_at, created_at,
      text_updated_at, completed_updated_at, position_updated_at, deleted_updated_at,
      saved_updated_at
    )
    values (
      (item->>'id')::uuid,
      uid,
      left(coalesce(item->>'text', ''), 2000),
      coalesce((item->>'completed')::boolean, false),
      (item->>'completed_at')::timestamptz,
      coalesce(item->>'position', 'a0'),
      (item->>'deleted_at')::timestamptz,
      (item->>'saved_at')::timestamptz,
      least(coalesce((item->>'created_at')::timestamptz, now()), max_clock),
      least(coalesce((item->>'text_updated_at')::timestamptz, now()), max_clock),
      least(coalesce((item->>'completed_updated_at')::timestamptz, now()), max_clock),
      least(coalesce((item->>'position_updated_at')::timestamptz, now()), max_clock),
      least(coalesce((item->>'deleted_updated_at')::timestamptz, now()), max_clock),
      -- An older client sends no saved clock: the epoch, so it never wins.
      least(coalesce((item->>'saved_updated_at')::timestamptz, '1970-01-01T00:00:00Z'), max_clock)
    )
    on conflict (id) do update set
      text = case
        when excluded.text_updated_at > existing.text_updated_at
        then excluded.text else existing.text end,
      text_updated_at = greatest(existing.text_updated_at, excluded.text_updated_at),

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

      saved_at = case
        when excluded.saved_updated_at > existing.saved_updated_at
        then excluded.saved_at else existing.saved_at end,
      saved_updated_at =
        greatest(existing.saved_updated_at, excluded.saved_updated_at),

      created_at = least(existing.created_at, excluded.created_at)
    returning existing.* into saved;

    return next saved;
  end loop;
end;
$$;

revoke all on function public.push_tasks(jsonb) from public;
grant execute on function public.push_tasks(jsonb) to authenticated;
