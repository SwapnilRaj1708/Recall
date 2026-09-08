import {
  DemoProvider,
  FullView,
  RecallProvider,
  useRecall,
  useTaskActions,
  useTasks,
} from '@recall/app';
import { ToastProvider } from '@recall/ui';
import { StrictMode, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { config, createStorage, demo } from './runtime.js';
import { androidOAuthLauncher } from './tauri.js';
import {
  applyWidgetOps,
  buildWidgetState,
  confirmWidgetOps,
  publishWidgetState,
  sameWidgetState,
  takeWidgetOps,
  type WidgetState,
} from './widget.js';

/**
 * Keeps the home-screen widget's snapshot in step with the list.
 *
 * Renders nothing. It sits inside the provider so it sees the same engine
 * everything else does, and writes only when what the widget would draw has
 * actually changed — the engine's version counter ticks for reasons the widget
 * does not care about, and this runs on the capture path.
 */
function WidgetBridge() {
  const { open, completed } = useTasks();
  const { authState, engine } = useRecall();
  const actions = useTaskActions();
  const previous = useRef<WidgetState | null>(null);
  const inFlight = useRef(false);

  /**
   * Take in anything done on the widget, then sync.
   *
   * On every return to the app, not once per launch. Android keeps this
   * process alive when you switch away, so a component that drains on mount
   * drains exactly once and never again — which is why captures made on the
   * widget sat there until the sync button was pressed. Coming back to the app
   * is the moment the user expects to see them.
   *
   * `inFlight` guards against overlap, not repetition: two drains at once
   * would claim the same batch twice.
   */
  const absorbWidgetWork = useCallback(async () => {
    if (authState.status !== 'signed-in' || inFlight.current) return;
    inFlight.current = true;
    try {
      // Wait for the local list to be in memory first. Sign-in resolves before
      // the cache finishes loading, and an edit or deletion naming a task the
      // engine has not loaded yet resolves to nothing and is dropped — the
      // queue having already been claimed. Captures never showed this, because
      // they do not depend on existing state.
      await engine.whenReady();

      const ops = await takeWidgetOps();
      if (ops.length > 0) {
        await applyWidgetOps(ops, actions);
        await confirmWidgetOps();
      }

      // Always, even with nothing to replay: opening the app is exactly when
      // someone wants to know the list is current.
      await actions.syncNow();
    } finally {
      inFlight.current = false;
    }
  }, [authState, actions, engine]);

  useEffect(() => {
    void absorbWidgetWork();
  }, [absorbWidgetWork]);

  // Returning to the app fires visibilitychange in the Android webview; there
  // is no separate resume event to listen for.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void absorbWidgetWork();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [absorbWidgetWork]);

  useEffect(() => {
    const signedIn = authState.status === 'signed-in';
    // Open tasks first: the widget is for what is still to be done, and a
    // small widget shows only the first few rows.
    const next = buildWidgetState([...open, ...completed], signedIn);
    if (sameWidgetState(previous.current, next)) return;
    previous.current = next;
    void publishWidgetState(next);
  }, [open, completed, authState]);

  return null;
}

function Providers({ children }: { children: ReactNode }) {
  if (demo) return <DemoProvider surface="mobile">{children}</DemoProvider>;
  return (
    <RecallProvider
      config={config}
      surface="mobile"
      storage={createStorage()}
      // Without a launcher the provider falls back to a web redirect, which
      // would navigate this webview to Google and never come back.
      oauthLauncher={androidOAuthLauncher}
    >
      {children}
    </RecallProvider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <Providers>
      <ToastProvider>
        <WidgetBridge />
        <FullView />
      </ToastProvider>
    </Providers>
  </StrictMode>,
);
