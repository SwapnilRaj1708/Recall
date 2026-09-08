import type { OAuthLauncher } from '@recall/core';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { openUrl } from '@tauri-apps/plugin-opener';

/**
 * The redirect Supabase sends the browser back to after Google sign-in.
 *
 * Android's own mechanism, rather than the loopback port the desktop uses. A
 * loopback listener does work on Android, but a custom scheme is what the
 * platform is built around: it survives the browser being backgrounded, and
 * Chrome Custom Tabs hand it straight back to the app.
 *
 * This exact string has to be on Supabase's redirect allow-list, and the
 * scheme has to match the intent filter Tauri generates from
 * `plugins.deep-link.mobile` in tauri.conf.json.
 */
export const DEEP_LINK_REDIRECT = 'recall://auth-callback';

const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Google sign-in on Android.
 *
 * The consent screen opens in the real browser, where the user is already
 * signed in to Google, and the result comes back as a deep link. Doing it in
 * the app's own webview would mean typing a Google password inside a
 * third-party app — worse practice, and something Google actively blocks.
 */
export const androidOAuthLauncher: OAuthLauncher = {
  async redirectTo() {
    return DEEP_LINK_REDIRECT;
  },

  async launch(authorizeUrl) {
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let stop: (() => void) | null = null;

      const finish = (run: () => void) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        stop?.();
        run();
      };

      const timeout = window.setTimeout(() => {
        finish(() =>
          reject(new Error('Sign-in timed out. Close the browser tab and try again.')),
        );
      }, SIGN_IN_TIMEOUT_MS);

      // Registered before the browser opens: on a slow device the callback can
      // arrive while this promise is still being set up.
      void onOpenUrl((urls) => {
        const callback = urls.find((url) => url.startsWith('recall://'));
        if (callback) finish(() => resolve(callback));
      })
        .then((unlisten) => {
          if (settled) unlisten();
          else stop = unlisten;
        })
        .catch((error: unknown) => {
          finish(() => reject(error instanceof Error ? error : new Error(String(error))));
        });

      openUrl(authorizeUrl).catch((error: unknown) => {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      });
    });
  },
};
