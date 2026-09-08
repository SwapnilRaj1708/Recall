import { DemoProvider, FullView, RecallProvider } from '@recall/app';
import { IndexedDbStorage, MemoryStorage, indexedDbAvailable } from '@recall/core';
import { ToastProvider } from '@recall/ui';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { config, redirectTo } from './config.js';
import './main.css';

/**
 * Demo mode runs the real engine against an in-memory server, so the whole
 * interface can be used before a Supabase project exists. Enabled with
 * `VITE_RECALL_DEMO=1`; it is never on by default.
 */
const demo = import.meta.env.VITE_RECALL_DEMO === '1';

/**
 * IndexedDB is unavailable in some private-browsing modes. Falling back to an
 * in-memory store keeps the app usable for the session rather than refusing to
 * start — the sync engine still delivers everything captured.
 */
const storage = indexedDbAvailable() ? new IndexedDbStorage() : new MemoryStorage();

function Providers({ children }: { children: ReactNode }) {
  if (demo) return <DemoProvider surface="web">{children}</DemoProvider>;
  return (
    <RecallProvider
      config={config}
      surface="web"
      storage={storage}
      detectSessionInUrl
      redirectTo={redirectTo}
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
        <FullView title={demo ? 'Recall (demo)' : 'Recall'} />
      </ToastProvider>
    </Providers>
  </StrictMode>,
);
