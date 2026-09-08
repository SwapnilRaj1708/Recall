import { DemoProvider, FullView, RecallProvider } from '@recall/app';
import { ToastProvider } from '@recall/ui';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { config, createStorage, demo } from './runtime.js';
import { androidOAuthLauncher } from './tauri.js';

/**
 * The phone app.
 *
 * Deliberately the same `FullView` the desktop and web apps render: one
 * product, four shells. What differs is the shell around it — sign-in comes
 * back through a deep link here, and the home-screen widget is fed from this
 * process.
 */
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
        <FullView />
      </ToastProvider>
    </Providers>
  </StrictMode>,
);
