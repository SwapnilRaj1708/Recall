-- Recall — settings that follow the account.
--
-- Paste this whole file into the Supabase SQL Editor and run it once, after
-- 0001 and 0002. It is idempotent, so re-running it is harmless.
--
-- Until it has been run, settings still work on each device; they just stay
-- on that device, and are sent the first time a sync finds the table.
--
-- The design mirrors the tasks table at a smaller scale:
--
--   * One row per account, holding every setting with the time it was chosen:
--     { "<key>": { "v": <value>, "t": "<ISO timestamp>" }, ... }
--
--   * `put_settings` is the write path and merges per key, newest stamp
--     winning, inside one statement. Two devices changing different settings
--     while apart therefore keep both; a whole-row upsert would keep only
--     whichever synced last.
--
--   * Stamps are returned in exactly the format JavaScript's toISOString()
--     produces, because clients compare them as strings.

-- =========================================================================
-- Table
-- =========================================================================

create table if not exists public.user_settings (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- =========================================================================
-- Row-level security
-- =========================================================================

alter table public.user_settings enable row level security;

drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own on public.user_settings
  for select using (auth.uid() = user_id);

drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own on public.user_settings
  for insert with check (auth.uid() = user_id);

drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own on public.user_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =========================================================================
-- put_settings — the write path
-- =========================================================================

create or replace function public.put_settings(patch jsonb)
returns jsonb
language plpgsql
-- SECURITY INVOKER, as with push_tasks: the policies above still apply inside.
security invoker
set search_path = public, pg_temp
as $$
declare
  uid       uuid := auth.uid();
  -- A device with a wrong clock could otherwise win every future comparison.
  max_clock timestamptz := now() + interval '5 minutes';
  merged    jsonb;
  key       text;
  incoming  jsonb;
  stamp     timestamptz;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if jsonb_typeof(patch) is distinct from 'object' then
    raise exception 'settings patch must be an object' using errcode = '22023';
  end if;

  insert into public.user_settings (user_id) values (uid)
  on conflict (user_id) do nothing;

  select settings into merged
  from public.user_settings
  where user_id = uid
  for update;

  for key, incoming in select * from jsonb_each(patch) loop
    continue when jsonb_typeof(incoming) is distinct from 'object'
      or not (incoming ? 'v')
      or not (incoming ? 't');

    stamp := least((incoming ->> 't')::timestamptz, max_clock);

    if not (merged ? key) or stamp > (merged -> key ->> 't')::timestamptz then
      merged := jsonb_set(
        merged,
        array[key],
        jsonb_build_object(
          'v', incoming -> 'v',
          't', to_char(stamp at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
      );
    end if;
  end loop;

  update public.user_settings
  set settings = merged, updated_at = now()
  where user_id = uid;

  return merged;
end;
$$;

revoke all on function public.put_settings(jsonb) from public;
grant execute on function public.put_settings(jsonb) to authenticated;

-- =========================================================================
-- Realtime
-- =========================================================================
--
-- So a change made on one device reaches the others while they are open,
-- rather than the next time they sync.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_settings'
  ) then
    alter publication supabase_realtime add table public.user_settings;
  end if;
end;
$$;
