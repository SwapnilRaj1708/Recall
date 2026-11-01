import type { SyncCredentials } from '@recall/app';
import { invoke } from '@tauri-apps/api/core';

/**
 * Lets the native side of the app reach the server on its own.
 *
 * A link shared into Recall from another app is received by a small native
 * activity that never starts the webview, so it cannot use the sync engine.
 * To send the link straight to the server it needs to act as the signed-in
 * user, and this hands it exactly that: the project's address, its public key,
 * and the current short-lived access token.
 *
 * Never the refresh token. Refresh tokens rotate, and a second holder using
 * one would make Supabase treat the session as stolen and sign the user out
 * everywhere. So the native side can only call the API while the token the
 * app last held is still valid — an hour after the app last refreshed it —
 * and otherwise queues the link for the app, which loses nothing.
 *
 * The file lives in app-private storage, the same sandbox as the webview's own
 * copy of the session.
 */
export async function publishSyncCredentials(credentials: SyncCredentials | null): Promise<void> {
  try {
    if (credentials && credentials.supabaseUrl && credentials.anonKey) {
      await invoke('publish_sync_credentials', {
        payload: JSON.stringify({ version: 1, ...credentials }),
      });
    } else {
      await invoke('clear_sync_credentials');
    }
  } catch {
    // Outside the Android shell, or the file could not be written. Shared
    // links still reach the server: they wait for the app to open instead.
  }
}
