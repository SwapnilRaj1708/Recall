import type { QuickAddHandle } from '@recall/ui';
import { IconButton, Menu, SyncBadge } from '@recall/ui';
import { useRef, useState } from 'react';
import { AuthGate } from '../components/AuthGate.js';
import { TaskListView } from '../components/TaskListView.js';
import { useRecall, useSyncStatus, useTaskActions, useTasks } from '../context.js';
import styles from './views.module.css';

export interface PopupViewProps {
  /** Opens the full web app in a tab. */
  onOpenApp?: () => void;
  onOpenOptions?: () => void;
}

/**
 * The browser-extension popup.
 *
 * Sized once and fixed — a popup that resizes as the list grows is jarring.
 * The capture field is focused on open, so clicking the toolbar icon and
 * typing is the whole interaction.
 */
export function PopupView({ onOpenApp, onOpenOptions }: PopupViewProps) {
  const { preferences, setPreferences } = useRecall();
  const status = useSyncStatus();
  const actions = useTaskActions();
  const { open } = useTasks();
  const captureRef = useRef<QuickAddHandle>(null);
  const [search] = useState('');

  return (
    <div className={styles.popup}>
      <header className={styles.popupHeader}>
        <span className={styles.brand}>
          <strong className={styles.brandTitle}>Recall</strong>
          {open.length > 0 ? <span className={styles.count}>{open.length}</span> : null}
        </span>

        <span className={styles.headerActions}>
          <SyncBadge {...status} compact onClick={() => void actions.syncNow()} />
          <Menu
            items={[
              ...(onOpenApp
                ? [{ label: 'Open full app', icon: 'inbox' as const, onSelect: onOpenApp }]
                : []),
              {
                label: preferences.showCompleted ? 'Hide completed' : 'Show completed',
                icon: 'check' as const,
                onSelect: () => setPreferences({ showCompleted: !preferences.showCompleted }),
              },
              ...(onOpenOptions
                ? [
                    {
                      label: 'Settings',
                      icon: 'settings' as const,
                      onSelect: onOpenOptions,
                      separatorBefore: true,
                    },
                  ]
                : []),
            ]}
            trigger={(props) => <IconButton icon="more" label="Menu" {...props} />}
          />
        </span>
      </header>

      <div className={styles.popupBody}>
        <AuthGate compact>
          <TaskListView
            variant="full"
            search={search}
            showCompleted={preferences.showCompleted}
            autoFocusCapture
            captureRef={captureRef}
          />
        </AuthGate>
      </div>
    </div>
  );
}
