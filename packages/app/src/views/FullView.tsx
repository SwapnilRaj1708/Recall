import type { QuickAddHandle } from '@recall/ui';
import { Button, IconButton, Modal, SyncBadge, TextInput } from '@recall/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AuthGate } from '../components/AuthGate.js';
import { SettingsPanel } from '../components/SettingsPanel.js';
import { TaskListView } from '../components/TaskListView.js';
import { useRecall, useSyncStatus, useTaskActions, useTasks } from '../context.js';
import styles from './views.module.css';

export interface FullViewProps {
  /** Extra controls in the header — the desktop app puts its widget toggle here. */
  headerExtra?: ReactNode;
  /** Host-specific settings, rendered inside the settings modal. */
  platformSettings?: ReactNode;
  title?: string;
}

/**
 * The full window: everything the widget deliberately leaves out.
 *
 * Search, the completed archive, sync detail, and settings live here precisely
 * so the widget can stay a list and a text field.
 */
export function FullView({ headerExtra, platformSettings, title = 'Recall' }: FullViewProps) {
  const { preferences, authState } = useRecall();
  const status = useSyncStatus();
  const actions = useTaskActions();
  const { open } = useTasks();

  const [search, setSearch] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [signOutWarning, setSignOutWarning] = useState<number | null>(null);
  const captureRef = useRef<QuickAddHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Keyboard-first: the two things worth a shortcut are capturing and finding.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.ctrlKey || event.metaKey;
      if (meta && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        captureRef.current?.focus();
      } else if (meta && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (meta && event.key === ',') {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className={styles.full}>
      <header className={styles.fullHeader}>
        <div className={styles.fullHeaderInner}>
          <div className={styles.brand}>
            <h1 className={styles.brandTitle}>{title}</h1>
            {open.length > 0 ? <span className={styles.count}>{open.length}</span> : null}
          </div>

          <TextInput
            ref={searchRef}
            className={styles.search}
            leadingIcon="search"
            placeholder="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSearch('');
            }}
            aria-label="Search tasks"
          />

          <div className={styles.headerActions}>
            {/*
              Nothing syncs before sign-in, so a badge here would sit on
              "Connecting" forever and describe work that is not happening.
            */}
            {authState.status === 'signed-in' ? (
              <SyncBadge {...status} onClick={() => void actions.syncNow()} />
            ) : null}
            {headerExtra}
            <IconButton icon="settings" label="Settings" onClick={() => setSettingsOpen(true)} />
          </div>
        </div>
      </header>

      <main className={styles.fullBody}>
        <AuthGate>
          <TaskListView
            variant="full"
            search={search}
            showCompleted={preferences.showCompleted}
            captureRef={captureRef}
          />
        </AuthGate>
      </main>

      <Modal open={settingsOpen} title="Settings" onClose={() => setSettingsOpen(false)}>
        <SettingsPanel
          platformSection={platformSettings}
          onSignOutBlocked={(pending) => setSignOutWarning(pending)}
        />
      </Modal>

      <Modal
        open={signOutWarning !== null}
        title="Unsaved changes"
        onClose={() => setSignOutWarning(null)}
        footer={
          <>
            <Button onClick={() => setSignOutWarning(null)}>Stay signed in</Button>
            <Button
              variant="primary"
              onClick={() => {
                void actions.syncNow();
                setSignOutWarning(null);
              }}
            >
              Sync now
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, lineHeight: 1.6 }}>
          {signOutWarning} change{signOutWarning === 1 ? '' : 's'} on this device
          {signOutWarning === 1 ? ' has' : ' have'} not reached the server yet. Signing out now
          would discard {signOutWarning === 1 ? 'it' : 'them'}. Sync first, then sign out.
        </p>
      </Modal>
    </div>
  );
}
