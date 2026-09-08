import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface RecallConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

/**
 * Async key/value store for the auth session. Only the extension needs a custom
 * one, because its service worker has no `localStorage`.
 */
export interface SessionStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

export interface ClientOptions {
  /** Override where the session is persisted. Defaults to the host's localStorage. */
  storage?: SessionStorage;
  /**
   * Whether to read an OAuth response out of the page URL on load. True only for
   * the web app, which is the surface that receives a browser redirect.
   */
  detectSessionInUrl?: boolean;
}

/**
 * The anon key is designed to ship inside clients — it grants nothing on its
 * own. Row-level security is what actually protects the data, which is why
 * every policy is scoped to `auth.uid()` and no client ever holds the
 * service-role key.
 */
export function createRecallClient(
  config: RecallConfig,
  options: ClientOptions = {},
): SupabaseClient {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error(
      'Missing Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    );
  }

  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: options.detectSessionInUrl ?? false,
      // PKCE keeps the flow safe in contexts that cannot hold a client secret,
      // which is all three of ours.
      flowType: 'pkce',
      ...(options.storage ? { storage: options.storage as never } : {}),
    },
    realtime: {
      params: { eventsPerSecond: 20 },
    },
    global: {
      headers: { 'x-recall-client': 'recall' },
    },
  });
}

/** True when both required values are present and look plausible. */
export function isConfigured(config: Partial<RecallConfig>): config is RecallConfig {
  return (
    typeof config.supabaseUrl === 'string' &&
    config.supabaseUrl.startsWith('http') &&
    typeof config.supabaseAnonKey === 'string' &&
    config.supabaseAnonKey.length > 20
  );
}
