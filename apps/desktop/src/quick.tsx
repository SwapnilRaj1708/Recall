import { DemoProvider, QuickCaptureView, RecallProvider } from '@recall/app';
import { widgetTheme } from '@recall/ui';
import { StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { config, createStorage, demo } from './runtime.js';
import { desktop, onQuickShown, tauriOAuthLauncher } from './tauri.js';

/**
 * The global-hotkey capture window.
 *
 * It stays loaded and hidden rather than being created on demand, so pressing
 * the hotkey shows an already-warm window with the engine running — the
 * difference between "instant" and "a beat too slow" for the interaction this
 * whole product is built around.
 */
function QuickCapture() {
  // Losing focus means the user has gone elsewhere; a capture bar left floating
  // over their work would be clutter, so it dismisses itself.
  useEffect(() => {
    const onBlur = () => void desktop.hideQuick();
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);

  // Rust announces each time the window is presented, so the field can be
  // re-focused even though the window was only hidden, never destroyed.
  useEffect(() => {
    const pending = onQuickShown(() => {
      window.focus();
      document.querySelector<HTMLInputElement>('input')?.focus();
    });
    return () => void pending.then((off) => off());
  }, []);

  return (
    <QuickCaptureView
      onDone={() => void desktop.hideQuick()}
      onCancel={() => void desktop.hideQuick()}
    />
  );
}

function Providers({ children }: { children: ReactNode }) {
  if (demo) return <DemoProvider surface="quick" themeFor={widgetTheme}>{children}</DemoProvider>;
  return (
    <RecallProvider
      config={config}
      surface="quick"
      storage={createStorage()}
      oauthLauncher={tauriOAuthLauncher}
      // Like the widget, this bar is a transparent window over the desktop.
      themeFor={widgetTheme}
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
      <QuickCapture />
    </Providers>
  </StrictMode>,
);
