import {
  AuthController,
  ChromeStorage,
  SupabaseRemote,
  SyncEngine,
  createRecallClient,
  isConfigured,
  type OAuthLauncher,
  type RecallConfig,
  type SessionStorage,
} from '@recall/core';

export const config: Partial<RecallConfig> = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
};

export const configured = isConfigured(config);

/**
 * The extension's session store.
 *
 * The popup and the service worker are separate contexts, and the service
 * worker has no `localStorage` at all. `chrome.storage.local` is visible to
 * both, so signing in from the popup leaves a session the background worker
 * can use to sync while the popup is closed.
 */
export const chromeSessionStorage: SessionStorage = {
  async getItem(key) {
    const result = await chrome.storage.local.get(key);
    return (result[key] as string | undefined) ?? null;
  },
  async setItem(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key) {
    await chrome.storage.local.remove(key);
  },
};

/**
 * Google sign-in from an extension.
 *
 * `launchWebAuthFlow` opens the consent screen in a Chrome-managed window and
 * hands back the redirect URL. The redirect target is derived from the
 * extension ID, which is pinned by the `key` field in the manifest — otherwise
 * it would change per machine and could never be allow-listed.
 */
export const chromeOAuthLauncher: OAuthLauncher = {
  redirectTo: () => chrome.identity.getRedirectURL(),
  launch: (authorizeUrl) =>
    new Promise<string>((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url: authorizeUrl, interactive: true }, (redirect) => {
        const failure = chrome.runtime.lastError;
        if (failure || !redirect) {
          reject(new Error(failure?.message ?? 'Sign-in was cancelled'));
          return;
        }
        resolve(redirect);
      });
    }),
};

export interface BackgroundRuntime {
  engine: SyncEngine;
  auth: AuthController;
}

let runtime: Promise<BackgroundRuntime> | null = null;

/**
 * Build (or reuse) the background worker's engine.
 *
 * MV3 kills the service worker after a short idle period, so this is
 * deliberately cheap to construct and safe to rebuild: all durable state lives
 * in `chrome.storage.local`, and the outbox survives the worker being killed
 * mid-flight.
 */
export function getBackgroundRuntime(): Promise<BackgroundRuntime> {
  runtime ??= (async () => {
    const client = createRecallClient(config as RecallConfig, {
      storage: chromeSessionStorage,
      detectSessionInUrl: false,
    });
    const remote = new SupabaseRemote(client);
    const auth = new AuthController(client, remote);
    const engine = new SyncEngine({
      storage: new ChromeStorage(),
      remote,
      // No realtime here: the worker is torn down long before a websocket
      // would earn its keep. Alarms and popup activity drive syncing instead.
      realtime: false,
      // Alarms are the schedule; an internal timer would just be killed.
      pullIntervalMs: 30 * 60_000,
      channelName: null,
    });

    await auth.init();
    await engine.start();
    return { engine, auth };
  })();

  return runtime;
}
