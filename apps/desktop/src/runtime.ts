import { IndexedDbStorage, isConfigured, type RecallConfig } from '@recall/core';

export const config: Partial<RecallConfig> = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
};

export const configured = isConfigured(config);

/** Demo mode: the real engine against an in-memory server, no backend needed. */
export const demo = import.meta.env.VITE_RECALL_DEMO === '1';

/**
 * All three windows share one IndexedDB database, because they share an origin
 * inside the Tauri shell. That is deliberate: a task captured in the widget is
 * in the main window's store before any server round trip, and the engine's
 * BroadcastChannel tells the other windows to re-read it immediately.
 */
export function createStorage(): IndexedDbStorage {
  return new IndexedDbStorage('recall');
}
