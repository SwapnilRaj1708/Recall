import {
  AuthController,
  SyncEngine,
  createRecallClient,
  isConfigured,
  SupabaseRemote,
  type AuthState,
  type OAuthLauncher,
  type RecallConfig,
  type SessionStorage,
  type StorageAdapter,
  type SyncStatus,
  type Task,
} from '@recall/core';
import { applyTheme, opaqueTheme, watchSystemTheme, type ThemeSettings } from '@recall/ui';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
  watchPreferences,
  type Preferences,
} from './settings.js';

export interface RecallProviderProps {
  config: Partial<RecallConfig>;
  /** Identifies this surface for per-surface preferences: 'web', 'widget', 'desktop', 'extension'. */
  surface: string;
  storage: StorageAdapter;
  /** Only the web app reads an OAuth response out of its own URL. */
  detectSessionInUrl?: boolean;
  /** Custom session store, needed where `localStorage` does not exist. */
  sessionStorage?: SessionStorage;
  /** How this surface opens the Google consent screen. Omitted on the web, which redirects. */
  oauthLauncher?: OAuthLauncher;
  /** Web only: where Supabase should send the browser back to. */
  redirectTo?: string;
  /**
   * How this surface renders the shared theme. Defaults to `opaqueTheme`,
   * which drops transparency because an ordinary window has nothing behind it.
   * The windows that do sit over the desktop pass `widgetTheme` instead.
   * Must be a stable reference — pass a module-level function, not a lambda.
   */
  themeFor?: (shared: ThemeSettings) => ThemeSettings;
  children: ReactNode;
}

export interface RecallContextValue {
  engine: SyncEngine;
  authState: AuthState;
  preferences: Preferences;
  setPreferences: (update: Partial<Preferences>) => void;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * Exported so a development harness can supply the same shape without a
 * backend. Application code should use the hooks, never the context directly.
 */
export const RecallContext = createContext<RecallContextValue | null>(null);

/**
 * Wires one surface to the shared engine.
 *
 * The engine starts regardless of sign-in state. That is deliberate: capture
 * has to work the instant the window opens, including before authentication has
 * resolved and including when it never resolves. Anything captured in that
 * window sits in the outbox and is delivered once a session exists.
 */
export function RecallProvider({
  config,
  surface,
  storage,
  detectSessionInUrl = false,
  sessionStorage,
  oauthLauncher,
  redirectTo,
  themeFor,
  children,
}: RecallProviderProps) {
  const configured = isConfigured(config);

  const [preferences, setPreferencesState] = useState<Preferences>(() =>
    loadPreferences(surface),
  );
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });
  const [configError, setConfigError] = useState<string | null>(null);

  // Built once. Rebuilding these on a render would drop the realtime channel
  // and the in-memory task map along with it.
  const services = useMemo(() => {
    if (!configured) return null;
    try {
      const client = createRecallClient(config as RecallConfig, {
        detectSessionInUrl,
        ...(sessionStorage ? { storage: sessionStorage } : {}),
      });
      const remote = new SupabaseRemote(client);
      const auth = new AuthController(client, remote);
      const engine = new SyncEngine({ storage, remote });
      return { client, remote, auth, engine };
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : String(error));
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  /* ------------------------------------------------------------- lifecycle */

  const previousUser = useRef<string | null>(null);

  useEffect(() => {
    if (!services) return;
    const { auth, engine } = services;

    const unsubscribeAuth = auth.subscribe(() => setAuthState(auth.getState()));

    let cancelled = false;

    // Deliberately not chained. The engine paints the cached list as soon as it
    // has one, and auth resolves on its own schedule; awaiting the engine first
    // meant that anything wrong with local storage left the whole interface
    // stuck on a loading skeleton, with no way to capture anything at all.
    void engine.start();

    void (async () => {
      const state = await auth.init();
      if (!cancelled) setAuthState(state);
    })();

    return () => {
      cancelled = true;
      unsubscribeAuth();
      auth.dispose();
      engine.stop();
    };
  }, [services]);

  // A new session means there may be a backlog in both directions.
  useEffect(() => {
    if (!services) return;
    const userId = authState.status === 'signed-in' ? authState.userId : null;
    if (userId && userId !== previousUser.current) void services.engine.syncNow();
    previousUser.current = userId;
  }, [services, authState]);

  /* ---------------------------------------------------------------- theme */

  // The stored theme is shared by every window; this is how *this* one shows it.
  const displayTheme = useMemo(
    () => (themeFor ?? opaqueTheme)(preferences.theme),
    [themeFor, preferences.theme],
  );

  useEffect(() => {
    applyTheme(document.documentElement, displayTheme);
  }, [displayTheme]);

  // "System" has to keep meaning system after the window has been open a while.
  useEffect(() => {
    if (displayTheme.mode !== 'system') return;
    return watchSystemTheme(() => applyTheme(document.documentElement, displayTheme));
  }, [displayTheme]);

  // Another window on this machine changing a preference should be reflected here.
  useEffect(() => watchPreferences(surface, setPreferencesState), [surface]);

  const setPreferences = useCallback(
    (update: Partial<Preferences>) => {
      setPreferencesState((current) => {
        const next: Preferences = {
          ...current,
          ...update,
          theme: { ...current.theme, ...update.theme },
        };
        savePreferences(surface, next);
        return next;
      });
    },
    [surface],
  );

  /* ----------------------------------------------------------------- auth */

  const signIn = useCallback(async () => {
    if (!services) return;
    if (oauthLauncher) {
      await services.auth.signInWithGoogleExternal(oauthLauncher);
      return;
    }

    // The redirect path navigates this very page to Google. That is right in a
    // browser tab and badly wrong in an application window: the window leaves
    // the app, Google refuses to render inside an embedded webview, and the
    // return trip lands on the app's root document rather than the page it
    // started from. Any host that is not a plain web origin must supply a
    // launcher that opens the system browser instead.
    if (!/^https?:$/.test(window.location.protocol) || isEmbeddedAppHost()) {
      setAuthState({
        status: 'signed-out',
        error:
          'This window cannot sign in on its own. It needs an OAuth launcher that opens your ' +
          'system browser — a wiring mistake in the host application, not something you can fix here.',
      });
      return;
    }

    await services.auth.signInWithGoogleRedirect(redirectTo ?? window.location.origin);
  }, [services, oauthLauncher, redirectTo]);

  const signOut = useCallback(async () => {
    if (!services) return;
    await services.auth.signOut();
    // Clear the local mirror so a signed-out machine does not keep a readable
    // copy of the list. Callers are expected to have checked for unsynced work.
    await services.engine.reset();
  }, [services]);

  const value = useMemo<RecallContextValue | null>(() => {
    if (!services) return null;
    return {
      engine: services.engine,
      authState,
      preferences,
      setPreferences,
      signIn,
      signOut,
    };
  }, [services, authState, preferences, setPreferences, signIn, signOut]);

  if (!value) {
    return (
      <ConfigurationNotice
        message={
          configError ??
          'Recall is not configured yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then reload.'
        }
      />
    );
  }

  return <RecallContext.Provider value={value}>{children}</RecallContext.Provider>;
}

/**
 * True when this page is inside an application shell rather than a browser tab.
 *
 * Tauri serves the app from `tauri.localhost` on Windows and the `tauri://`
 * scheme elsewhere; a Chrome extension page runs on `chrome-extension://`.
 * None of them can complete a top-level OAuth redirect.
 */
function isEmbeddedAppHost(): boolean {
  const { protocol, hostname } = window.location;
  return (
    protocol === 'tauri:' ||
    protocol === 'chrome-extension:' ||
    hostname === 'tauri.localhost' ||
    hostname.endsWith('.tauri.localhost')
  );
}

function ConfigurationNotice({ message }: { message: string }) {
  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        height: '100%',
        padding: 24,
        textAlign: 'center',
        font: 'inherit',
        color: 'var(--rc-text-secondary)',
      }}
    >
      <div style={{ maxWidth: 380, lineHeight: 1.6 }}>
        <strong style={{ display: 'block', marginBottom: 8, color: 'var(--rc-text)' }}>
          Configuration needed
        </strong>
        {message}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- hooks */

export function useRecall(): RecallContextValue {
  const context = useContext(RecallContext);
  if (!context) throw new Error('useRecall must be used inside a RecallProvider');
  return context;
}

/**
 * Subscribe to the engine's change counter rather than to the task arrays.
 *
 * `getTasks()` builds a fresh array on every call, so returning it directly
 * from a `useSyncExternalStore` snapshot would make React think the store
 * changed on every render and loop forever.
 */
function useEngineVersion(): number {
  const { engine } = useRecall();
  return useSyncExternalStore(
    useCallback((listener) => engine.subscribe(listener), [engine]),
    useCallback(() => engine.getVersion(), [engine]),
    useCallback(() => engine.getVersion(), [engine]),
  );
}

export interface TaskLists {
  open: Task[];
  completed: Task[];
  deleted: Task[];
  all: Task[];
}

export function useTasks(): TaskLists {
  const { engine } = useRecall();
  const version = useEngineVersion();
  return useMemo(
    () => ({
      open: engine.getOpenTasks(),
      completed: engine.getCompletedTasks(),
      deleted: engine.getDeletedTasks(),
      all: engine.getTasks(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, version],
  );
}

export function useSyncStatus(): SyncStatus {
  const { engine } = useRecall();
  const version = useEngineVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => engine.getStatus(), [engine, version]);
}

/** Stable, memoised task actions, so callbacks do not re-create on every render. */
/**
 * Which tasks are still only on this device.
 *
 * Rendered differently so a capture that has not reached the server is
 * visibly not-yet-safe. That matters most right after the app opens with work
 * replayed from the home-screen widget: those rows exist locally seconds
 * before they exist anywhere else, and silently showing them as ordinary
 * tasks would overstate what has actually been saved.
 */
export function useUnsyncedIds(): ReadonlySet<string> {
  const { engine } = useRecall();
  const version = useEngineVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => engine.getUnsyncedIds(), [engine, version]);
}

export function useTaskActions() {
  const { engine } = useRecall();
  return useMemo(
    () => ({
      /**
       * `id` is forwarded, not dropped: a surface that captured somewhere the
       * engine could not reach — the Android widget — supplies the id it
       * already minted, and replaying that capture then converges on the same
       * row instead of creating a second.
       */
      capture: (text: string, id?: string) => engine.capture(text, id),
      setText: (id: string, text: string) => engine.setText(id, text),
      setCompleted: (id: string, completed: boolean) => engine.setCompleted(id, completed),
      remove: (id: string) => engine.remove(id),
      restore: (id: string) => engine.restore(id),
      moveToIndex: (id: string, index: number, visible?: Task[]) =>
        engine.moveToIndex(id, index, visible),
      syncNow: () => engine.syncNow(),
      retryFailed: () => engine.retryFailed(),
      hasUnsyncedWork: () => engine.hasUnsyncedWork(),
    }),
    [engine],
  );
}

export { DEFAULT_PREFERENCES };
export type { Preferences };
