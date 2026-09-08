import { DemoProvider, FullView, RecallProvider, loadPreferences, savePreferences } from '@recall/app';
import { ToastProvider, IconButton } from '@recall/ui';
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { DesktopSettings } from './DesktopSettings.js';
import { config, createStorage, demo } from './runtime.js';
import { desktop, onWidgetVisibility, tauriOAuthLauncher } from './tauri.js';

/**
 * The full desktop window: everything the widget deliberately leaves out.
 */
function DesktopApp() {
  const initial = loadPreferences('desktop');
  const [alwaysOnTop, setAlwaysOnTop] = useState(initial.alwaysOnTop);
  const [hotkey, setHotkey] = useState(initial.globalHotkey);
  const [widgetVisible, setWidgetVisible] = useState(true);

  // The widget can also be hidden from its own menu or the tray, so its state
  // is read once and then followed, rather than assumed from our own clicks.
  useEffect(() => {
    void desktop.isWidgetVisible().then(setWidgetVisible).catch(() => {});
    const pending = onWidgetVisibility(setWidgetVisible);
    return () => void pending.then((off) => off());
  }, []);

  const persist = (update: { alwaysOnTop?: boolean; globalHotkey?: string }) => {
    savePreferences('desktop', { ...loadPreferences('desktop'), ...update });
  };

  return (
    <FullView
      headerExtra={
        /*
          A "panel" icon, not the pin: the widget's own header already uses a
          pin for always-on-top, and the same icon meaning two different things
          one window apart is worse than no icon at all.
        */
        <IconButton
          icon="panel"
          label={widgetVisible ? 'Hide the desktop widget' : 'Show the desktop widget'}
          aria-pressed={widgetVisible}
          className={widgetVisible ? 'rc-toggle-on' : undefined}
          onClick={() => void desktop.toggleWidget().then(setWidgetVisible)}
        />
      }
      platformSettings={
        <DesktopSettings
          alwaysOnTop={alwaysOnTop}
          onAlwaysOnTopChange={(value) => {
            setAlwaysOnTop(value);
            persist({ alwaysOnTop: value });
          }}
          hotkey={hotkey}
          onHotkeyChange={(value) => {
            setHotkey(value);
            persist({ globalHotkey: value });
          }}
        />
      }
    />
  );
}

function Providers({ children }: { children: ReactNode }) {
  if (demo) return <DemoProvider surface="desktop">{children}</DemoProvider>;
  return (
    <RecallProvider
      config={config}
      surface="desktop"
      storage={createStorage()}
      oauthLauncher={tauriOAuthLauncher}
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
        <DesktopApp />
      </ToastProvider>
    </Providers>
  </StrictMode>,
);
