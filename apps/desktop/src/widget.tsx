import { DemoProvider, RecallProvider, WidgetView, loadPreferences, savePreferences } from '@recall/app';
import { ToastProvider, widgetTheme } from '@recall/ui';
import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { config, createStorage, demo } from './runtime.js';
import { desktop, tauriOAuthLauncher } from './tauri.js';

/**
 * The always-visible desktop widget.
 *
 * A panel that sits permanently over the desktop wants denser rows and a
 * translucent background, so it renders the shared theme through
 * `widgetTheme`. Its own preference slot holds only host settings — the
 * appearance record is shared, because this window has no settings screen and
 * a theme stored here would be one nobody could ever change.
 */
function Widget() {
  const [alwaysOnTop, setAlwaysOnTop] = useState(() => loadPreferences('widget').alwaysOnTop);

  const toggleAlwaysOnTop = () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    void desktop.setWidgetAlwaysOnTop(next);
    savePreferences('widget', { ...loadPreferences('widget'), alwaysOnTop: next });
  };

  return (
    <WidgetView
      // Tauri turns any element carrying this attribute into a window drag
      // handle, which is how a frameless widget gets moved.
      dragRegionProps={{ 'data-tauri-drag-region': true }}
      alwaysOnTop={alwaysOnTop}
      onToggleAlwaysOnTop={toggleAlwaysOnTop}
      onOpenApp={() => void desktop.showMain()}
      onHide={() => void desktop.hideWidget()}
      extraMenuItems={[{ label: 'Quick capture', onSelect: () => void desktop.showQuick() }]}
    />
  );
}

function Providers({ children }: { children: ReactNode }) {
  if (demo) {
    return (
      <DemoProvider surface="widget" themeFor={widgetTheme}>
        {children}
      </DemoProvider>
    );
  }
  return (
    <RecallProvider
      config={config}
      surface="widget"
      storage={createStorage()}
      // Without this the sign-in falls back to the web redirect and navigates
      // this window away to Google — which lands back on index.html and turns
      // the widget into the full app. Every Tauri window needs the launcher.
      oauthLauncher={tauriOAuthLauncher}
      // Denser and translucent, but built from the same shared theme the
      // settings screen edits — the widget has no settings screen of its own.
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
      <ToastProvider>
        <Widget />
      </ToastProvider>
    </Providers>
  </StrictMode>,
);
