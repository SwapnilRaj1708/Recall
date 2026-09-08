import { IndexedDbStorage, isConfigured, type RecallConfig } from '@recall/core';

export const config: Partial<RecallConfig> = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
};

export const configured = isConfigured(config);

/** Demo mode: the real engine against an in-memory server, no backend needed. */
export const demo = import.meta.env.VITE_RECALL_DEMO === '1';

/**
 * Android's WebView is Chromium, so IndexedDB is the same store the web app
 * uses. It survives the app being killed, which is what makes a capture safe
 * the instant it is typed rather than once it reaches the server.
 */
export function createStorage(): IndexedDbStorage {
  return new IndexedDbStorage('recall');
}
