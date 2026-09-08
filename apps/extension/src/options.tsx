import { RecallProvider, SettingsPanel, Row } from '@recall/app';
import { ChromeStorage } from '@recall/core';
import { Kbd, ToastProvider } from '@recall/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { chromeOAuthLauncher, chromeSessionStorage, config } from './runtime.js';
import { useCommandShortcut } from './useCommandShortcut.js';
import './options.css';

/**
 * The extension's own settings page. Uses the shared SettingsPanel, so the
 * appearance controls here behave identically to the desktop app's.
 */
function Options() {
  const shortcut = useCommandShortcut();

  return (
    <main className="options">
      <h1 className="optionsTitle">Recall</h1>
      <SettingsPanel
        platformSection={
          <>
            <Row
              label="Open the popup"
              hint={
                shortcut
                  ? 'Change it at chrome://extensions/shortcuts'
                  : 'No shortcut is assigned — the suggested one is already taken. Set your own at chrome://extensions/shortcuts.'
              }
            >
              {shortcut ? <Kbd>{shortcut}</Kbd> : <span className="optionsMuted">Not set</span>}
            </Row>
            <Row label="Capture from the address bar" hint="Type the keyword, a space, then the task.">
              <Kbd>r</Kbd>
            </Row>
          </>
        }
      />
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

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
        <Options />
      </ToastProvider>
    </RecallProvider>
  </StrictMode>,
);
