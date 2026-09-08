import type { RecallConfig } from '@recall/core';

/**
 * Configuration comes from build-time environment variables, never from source.
 *
 * The anon key is safe in a client bundle by design — it authorises nothing on
 * its own, and row-level security is what actually protects the data. The
 * service-role key must never appear here or anywhere else in this repository.
 */
export const config: Partial<RecallConfig> = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
};

/** Where Supabase sends the browser back after Google sign-in. */
export const redirectTo = `${window.location.origin}/`;
