/**
 * Verifies a real Supabase project against what Recall expects.
 *
 * Run this straight after applying the migration. It answers the questions that
 * are genuinely hard to eyeball in the dashboard: did every object actually get
 * created, is row-level security really on, and does realtime deliver.
 *
 *   node scripts/live-check.mjs
 *
 * It uses only the anon key, so it is safe to run at any time and cannot see or
 * change your tasks. That is also the point of the security checks: everything
 * below *should* be refused.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const candidates = ['apps/web/.env', 'apps/desktop/.env', 'apps/extension/.env', '.env'];
  for (const relative of candidates) {
    try {
      const text = readFileSync(join(ROOT, relative), 'utf8');
      const values = Object.fromEntries(
        text
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#'))
          .map((line) => {
            const at = line.indexOf('=');
            return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
          }),
      );
      if (values.VITE_SUPABASE_URL && values.VITE_SUPABASE_ANON_KEY) {
        return { ...values, source: relative };
      }
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

const env = loadEnv();
if (!env) {
  console.error('No .env found with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  console.error('See docs/SETUP.md step D.');
  process.exit(1);
}

console.log(`Checking ${env.VITE_SUPABASE_URL}`);
console.log(`Configuration from ${env.source}\n`);

const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
};

/* 1. The table exists and is reachable. */
{
  const { error } = await client.from('tasks').select('id').limit(1);
  if (error && /does not exist|schema cache/i.test(error.message)) {
    record('tasks table exists', false, 'run supabase/migrations/0001_init.sql');
  } else {
    record('tasks table exists', true);
  }
}

/* 2. Row-level security hides everything from an unauthenticated caller. */
{
  const { data, error } = await client.from('tasks').select('id');
  const blocked = !error && Array.isArray(data) && data.length === 0;
  record(
    'row-level security blocks anonymous reads',
    blocked || Boolean(error),
    blocked ? undefined : error ? error.message : 'anonymous read returned rows — RLS is NOT on',
  );
}

/* 3. Anonymous writes are refused. */
{
  const { error } = await client.from('tasks').insert({
    id: '00000000-0000-4000-8000-000000000001',
    text: 'live-check probe',
    position: 'a0',
  });
  record('row-level security blocks anonymous writes', Boolean(error), error?.code ?? 'INSERT SUCCEEDED');
}

/* 4. The merge function exists and refuses unauthenticated callers. */
{
  const { error } = await client.rpc('push_tasks', { batch: [] });
  if (error && /not found|does not exist|schema cache/i.test(error.message)) {
    record('push_tasks function exists', false, 'the migration did not finish');
  } else {
    record('push_tasks function exists', true);
    record(
      'push_tasks refuses unauthenticated callers',
      Boolean(error),
      error ? undefined : 'it accepted an anonymous call',
    );
  }
}

/* 5. Realtime is reachable and the table is published. */
{
  const connected = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 12_000);
    const channel = client
      .channel('live-check')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {})
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          resolve(true);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer);
          resolve(false);
        }
      });
    setTimeout(() => void client.removeChannel(channel), 12_500);
  });

  record(
    'realtime channel connects',
    connected,
    connected ? undefined : 'sync still works by polling, but changes take up to 2 minutes',
  );
}

/* 6. Google sign-in is configured. */
{
  const response = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY },
  });
  const settings = await response.json().catch(() => ({}));
  const google = Boolean(settings?.external?.google);
  record(
    'Google sign-in is enabled',
    google,
    google ? undefined : 'enable it under Authentication → Providers (SETUP.md step C2)',
  );
}

const failed = results.filter((r) => !r.ok);
console.log('');
if (failed.length === 0) {
  console.log('Everything checks out. Recall is ready to sign in to.');
  process.exit(0);
}

console.log(`${failed.length} check${failed.length === 1 ? '' : 's'} failed:`);
for (const failure of failed) console.log(`  - ${failure.name}`);
process.exit(1);
