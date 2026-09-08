import { PopupView, RecallProvider } from '@recall/app';
import { ChromeStorage } from '@recall/core';
import { ToastProvider } from '@recall/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { chromeOAuthLauncher, chromeSessionStorage, config } from './runtime.js';

/**
 * The popup runs a full engine with realtime enabled: it is on screen and
 * focused, which is exactly when a live connection is worth having, and it is
 * closed again within seconds so the connection is short-lived.
 */
const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

/** The web app, for "open the full app". Falls back to the extension's own page. */
const WEB_APP_URL = import.meta.env.VITE_RECALL_WEB_URL || '';

createRoot(root).render(
  <StrictMode>
    <RecallProvider
      config={config}
      surface="extension"
      storage={new ChromeStorage()}
      sessionStorage={chromeSessionStorage}
      oauthLauncher={chromeOAuthLauncher}
    >
      <ToastProvider>
        <PopupView
          onOpenApp={
            WEB_APP_URL
              ? () => {
                  void chrome.tabs.create({ url: WEB_APP_URL });
                }
              : undefined
          }
          onOpenOptions={() => chrome.runtime.openOptionsPage()}
        />
      </ToastProvider>
    </RecallProvider>
  </StrictMode>,
);
