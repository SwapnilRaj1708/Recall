import {
  DemoProvider,
  FullView,
  RecallProvider,
  useRecall,
  useTaskActions,
  useTasks,
} from '@recall/app';
import { ToastProvider } from '@recall/ui';
import { StrictMode, useEffect, useRef, type ReactNode } from 'react';
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
  const draining = useRef(false);

  // Anything tapped on the home screen while the app was closed is replayed
  // the moment the app has a session. Runs once: the shell holds the batch
  // until it is confirmed, so this cannot half-apply and move on.
  useEffect(() => {
    if (authState.status !== 'signed-in' || draining.current) return;
    draining.current = true;
    void (async () => {
      // Wait for the local list to be in memory first. Sign-in resolves before
      // the cache finishes loading, and an edit or deletion naming a task the
      // engine has not loaded yet resolves to nothing and is dropped — the
      // queue having already been claimed. Captures never showed this, because
      // they do not depend on existing state.
      await engine.whenReady();

      const ops = await takeWidgetOps();
      if (ops.length === 0) return;
      await applyWidgetOps(ops, actions);
      await confirmWidgetOps();
    })();
  }, [authState, actions, engine]);

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
