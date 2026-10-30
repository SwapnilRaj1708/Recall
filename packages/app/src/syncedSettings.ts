import {
  DEFAULT_SETTINGS,
  nextLocalMidnight,
  startOfLocalDay,
  type SettingsStore,
  type SyncEngine,
  type SyncedSettings,
} from '@recall/core';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { applyCustomization, customizationVars } from './customize.js';

/** The current synced settings, re-rendering when any device changes them. */
export function useSettingsSnapshot(store: SettingsStore | null): SyncedSettings {
  return useSyncExternalStore(
    useCallback((listener) => store?.subscribe(listener) ?? (() => {}), [store]),
    useCallback(() => store?.get() ?? DEFAULT_SETTINGS, [store]),
    useCallback(() => store?.get() ?? DEFAULT_SETTINGS, [store]),
  );
}

/** setTimeout cannot wait longer than this; a day is well inside it. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * What the synced settings do, as opposed to what they say.
 *
 * Shared by the real provider and the demo one, so the demo behaves exactly
 * like the product: new tasks land where the setting says, Customize restyles
 * the page, and finished tasks are cleared at midnight.
 */
export function useSyncedSettingsEffects(
  engine: SyncEngine | null,
  store: SettingsStore | null,
): SyncedSettings {
  const settings = useSettingsSnapshot(store);

  useEffect(() => {
    engine?.setNewTaskPlacement(settings.addToBottom ? 'bottom' : 'top');
  }, [engine, settings.addToBottom]);

  const vars = useMemo(() => customizationVars(settings), [settings]);
  useEffect(() => {
    if (store) applyCustomization(document.documentElement, vars);
  }, [store, vars]);

  /*
   * The end-of-day clear-out.
   *
   * "At the end of each day" cannot rely on the app being open at midnight —
   * a laptop is asleep, a phone app is in the background — so the rule is
   * applied whenever there is a chance: on start, at the next local midnight
   * if still open, and every time the window comes back to the front. Each run
   * clears what was finished before today began, so running it late, or more
   * than once, or in several windows, comes to the same thing.
   */
  useEffect(() => {
    if (!engine || !settings.autoClearCompleted) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = () => {
      void engine.whenReady().then(() => {
        if (!cancelled) return engine.clearCompletedBefore(startOfLocalDay(new Date()));
        return undefined;
      });
    };
    const schedule = () => {
      // A second past midnight, so the new day has unambiguously begun.
      const delay = nextLocalMidnight(new Date()).getTime() - Date.now() + 1000;
      timer = setTimeout(() => {
        run();
        schedule();
      }, Math.min(delay, MAX_TIMEOUT_MS));
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };

    run();
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [engine, settings.autoClearCompleted]);

  return settings;
}
