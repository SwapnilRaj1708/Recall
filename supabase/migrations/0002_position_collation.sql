-- Make Postgres order `position` exactly the way the clients do.
--
-- Fractional index keys are compared as raw character sequences. JavaScript's
-- `<` on strings is UTF-16 code-unit order, so "Zz" sorts before "a0". A
-- Postgres database created with a linguistic collation (the Supabase default)
-- disagrees: it sorts "a0" before "Zz", because it is applying dictionary
-- rules to what is really an opaque byte string.
--
-- Today nothing depends on this. Clients sort the list themselves and delta
-- pulls are ordered by `server_updated_at`, so the mismatch is invisible. It
-- would stop being invisible the moment anything orders or paginates by
-- position server-side — and it would do so quietly, as a wrong order rather
-- than an error, which is the worst way for a bug like this to arrive.
--
-- The "C" collation is plain byte order, which is what the clients implement.
-- Pinning it here means the two can never drift apart.

alter table public.tasks
  alter column position type text collate "C";

comment on column public.tasks.position is
  'Fractional index. COLLATE "C" so Postgres byte-orders it, matching the '
  'clients'' code-unit comparison exactly. Do not change the collation.';

-- Rebuild the ordering index under the new collation.
drop index if exists tasks_user_position_idx;
create index tasks_user_position_idx
  on public.tasks (user_id, position)
  where deleted_at is null;
