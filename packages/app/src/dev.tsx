import { MemoryStorage, SyncEngine, type AuthState } from '@recall/core';
import { FakeRemote, FakeServer } from '@recall/core/testing';
import { applyTheme, opaqueTheme, watchSystemTheme, type ThemeSettings } from '@recall/ui';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { RecallContext, type RecallContextValue } from './context.js';
import {
  loadPreferences,
  savePreferences,
  watchPreferences,
  type Preferences,
} from './settings.js';

const DEMO_USER: AuthState = {
  status: 'signed-in',
  userId: 'demo-user',
  email: 'demo@recall.local',
};

const SEED = [
  'Renew my passport',
  'Call the electrician about the fuse box',
  'Book the dentist for a check-up',
  'Reply to Priya about the weekend',
];

export interface DemoProviderProps {
  surface: string;
  children: ReactNode;
  /** See `RecallProviderProps.themeFor`. */
  themeFor?: (shared: ThemeSettings) => ThemeSettings;
}

/**
 * A fully working Recall with no backend.
 *
 * This runs the real SyncEngine against the same in-memory server the
 * convergence tests use, so every interaction — capture, edit, complete,
 * reorder, delete and undo, offline queueing — behaves exactly as it will in
 * production. It exists so the interface can be built and reviewed before any
 * Supabase project has been created, and so a first-time reader can see the
 * product working with a single command.
 */
export function DemoProvider({ surface, children, themeFor }: DemoProviderProps) {
  const [preferences, setPreferencesState] = useState<Preferences>(() =>
    loadPreferences(surface),
  );

  const engine = useMemo(() => {
    const server = new FakeServer();
    const remote = new FakeRemote(server, DEMO_USER.status === 'signed-in' ? 'demo-user' : null);
    return new SyncEngine({ storage: new MemoryStorage(), remote, channelName: null });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await engine.start();
      if (cancelled) return;
      // Seed oldest-first so the newest capture ends up at the top, matching
      // what a real list looks like after a few days of use.
      for (const text of [...SEED].reverse()) await engine.capture(text);
      await engine.syncNow();
    })();
    return () => {
      cancelled = true;
      engine.stop();
    };
  }, [engine]);

  // Same as the real provider: another window changing the shared theme has to
  // reach this one, or the demo stops demonstrating the product.
  useEffect(() => watchPreferences(surface, setPreferencesState), [surface]);

  const displayTheme = useMemo(
    () => (themeFor ?? opaqueTheme)(preferences.theme),
    [themeFor, preferences.theme],
  );

  useEffect(() => {
    applyTheme(document.documentElement, displayTheme);
  }, [displayTheme]);

  useEffect(() => {
    if (displayTheme.mode !== 'system') return;
    return watchSystemTheme(() => applyTheme(document.documentElement, displayTheme));
  }, [displayTheme]);

  const setPreferences = useCallback(
    (update: Partial<Preferences>) => {
      setPreferencesState((current) => {
        const next = { ...current, ...update, theme: { ...current.theme, ...update.theme } };
        savePreferences(surface, next);
        return next;
      });
    },
    [surface],
  );

  const value = useMemo<RecallContextValue>(
    () => ({
      engine,
      authState: DEMO_USER,
      preferences,
      setPreferences,
      signIn: async () => {},
      signOut: async () => {},
    }),
    [engine, preferences, setPreferences],
  );

  return <RecallContext.Provider value={value}>{children}</RecallContext.Provider>;
}
