import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { OAuthLauncher } from '@recall/core';

/**
 * Typed bridge to the Rust shell.
 *
 * Window behaviour, the tray, the hotkey and autostart all live in Rust, so
 * this file is the whole surface between the two halves of the desktop app.
 */

/** True when running inside the Tauri shell rather than a plain browser tab. */
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Outside the shell — a browser preview, or the same pages opened in demo mode
 * — these commands do not exist. Returning a benign default keeps the shared
 * UI renderable in a plain browser instead of throwing on first paint.
 */
function command<T>(name: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  if (!isTauri()) return Promise.resolve(fallback);
  return invoke<T>(name, args);
}

export const desktop = {
  showMain: () => command<void>('show_main', {}, undefined as void),
  showWidget: () => command<void>('show_widget', {}, undefined as void),
  hideWidget: () => command<void>('hide_widget', {}, undefined as void),
  toggleWidget: () => command<boolean>('toggle_widget', {}, true),
  isWidgetVisible: () => command<boolean>('is_widget_visible', {}, true),
  setWidgetAlwaysOnTop: (onTop: boolean) =>
    command<void>('set_widget_always_on_top', { onTop }, undefined as void),
  showQuick: () => command<void>('show_quick', {}, undefined as void),
  hideQuick: () => command<void>('hide_quick', {}, undefined as void),
  getAutostart: () => command<boolean>('get_autostart', {}, false),
  setAutostart: (enabled: boolean) =>
    command<void>('set_autostart', { enabled }, undefined as void),
  setGlobalHotkey: (accelerator: string) =>
    command<void>('set_global_hotkey', { accelerator }, undefined as void),
  getHotkeyStatus: () =>
    command<HotkeyStatus>('get_hotkey_status', {}, {
      accelerator: '',
      registered: false,
      error: null,
    }),
};

/** Whether quick capture is actually armed, and why not if it is not. */
export interface HotkeyStatus {
  accelerator: string;
  registered: boolean;
  error: string | null;
}

/**
 * Fired whenever the widget is shown or hidden — from the main window, the
 * widget's own menu, or the tray. Without this the main window's toggle would
 * show whatever was true when it last rendered.
 */
export const onWidgetVisibility = (handler: (visible: boolean) => void): Promise<() => void> => {
  if (!isTauri()) return Promise.resolve(() => {});
  return listen<boolean>('recall://widget-visibility', (event) => handler(event.payload));
};

/** Fired by Rust each time the quick-capture window is presented. */
export const onQuickShown = (handler: () => void): Promise<() => void> => {
  if (!isTauri()) return Promise.resolve(() => {});
  return listen('recall://quick-shown', () => handler());
};

/**
 * Google sign-in on the desktop.
 *
 * The consent screen opens in the user's real browser — where they are already
 * signed in to Google — and Rust catches the redirect on a loopback port. Doing
 * it in an embedded webview would mean re-entering a Google password inside an
 * app, which is both worse security practice and something Google actively
 * blocks.
 */
export const tauriOAuthLauncher: OAuthLauncher = {
  async redirectTo() {
    const port = await invoke<number>('start_oauth_listener');
    return `http://localhost:${port}/callback`;
  },

  async launch(authorizeUrl) {
    return new Promise<string>((resolve, reject) => {
      let settled = false;

      const timeout = window.setTimeout(
        () => {
          if (settled) return;
          settled = true;
          void unlisten.then((off) => off());
          reject(new Error('Sign-in timed out. Close the browser tab and try again.'));
        },
        5 * 60 * 1000,
      );

      const unlisten = listen<string>('recall://oauth-callback', (event) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        void unlisten.then((off) => off());
        resolve(event.payload);
      });

      openUrl(authorizeUrl).catch((error: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        void unlisten.then((off) => off());
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  },
};
