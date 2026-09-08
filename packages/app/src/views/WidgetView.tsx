import type { QuickAddHandle } from '@recall/ui';
import { IconButton, Menu, SyncBadge } from '@recall/ui';
import { useEffect, useRef, type ReactNode } from 'react';
import { AuthGate } from '../components/AuthGate.js';
import { TaskListView } from '../components/TaskListView.js';
import { useRecall, useSyncStatus, useTasks } from '../context.js';
import styles from './views.module.css';

export interface WidgetViewProps {
  /** Props the host puts on the drag strip — Tauri needs `data-tauri-drag-region`. */
  dragRegionProps?: Record<string, unknown>;
  onOpenApp?: () => void;
  onHide?: () => void;
  onToggleAlwaysOnTop?: () => void;
  alwaysOnTop?: boolean;
  extraMenuItems?: { label: string; onSelect: () => void }[];
  footer?: ReactNode;
}

/**
 * The always-visible desktop widget.
 *
 * This is the surface that does the real work of the product: it sits in
 * peripheral vision so tasks keep existing without anyone deciding to look at
 * them. Everything here is subordinate to that — the chrome is one 26px strip,
 * the list gets the rest, and nothing animates or demands attention.
 */
export function WidgetView({
  dragRegionProps,
  onOpenApp,
  onHide,
  onToggleAlwaysOnTop,
  alwaysOnTop = true,
  extraMenuItems = [],
  footer,
}: WidgetViewProps) {
  const { preferences } = useRecall();
  const status = useSyncStatus();
  const { open } = useTasks();
  const captureRef = useRef<QuickAddHandle>(null);

  // The widget is a capture surface first. Whenever it is shown or regains
  // focus, the caret belongs in the input without anyone having to click.
  useEffect(() => {
    const focusCapture = () => captureRef.current?.focus();
    focusCapture();
    window.addEventListener('focus', focusCapture);
    return () => window.removeEventListener('focus', focusCapture);
  }, []);

  return (
    <div className={`${styles.widget} rc-glass`}>
      <header className={styles.widgetHeader} {...dragRegionProps}>
        {/*
          The drag attribute has to be on the title as well as the bar. Tauri
          only starts a drag when the element under the pointer carries it, and
          the title fills most of the bar — with it only on the header, the
          draggable area is the few pixels of gap around the text, which reads
          as "this widget cannot be moved".
        */}
        <span className={styles.widgetTitle} {...dragRegionProps}>
          Recall
          {open.length > 0 ? <span className={styles.count}>{open.length}</span> : null}
        </span>

        <span className={styles.widgetHeaderActions}>
          <SyncBadge {...status} compact />

          {/*
            Pinning gets its own always-visible control rather than living only
            in the overflow menu. It is the setting people reach for most, it
            has a state worth showing at a glance, and a dim 24px "more" icon is
            not somewhere anyone expects to find it. It stays available when
            signed out, because where the widget sits on screen has nothing to
            do with whether there is an account behind it.
          */}
          {onToggleAlwaysOnTop ? (
            <IconButton
              icon="pin"
              label={alwaysOnTop ? 'Pinned on top — click to rest on the desktop' : 'Resting on the desktop — click to pin on top'}
              size={13}
              className={alwaysOnTop ? styles.pinActive : undefined}
              aria-pressed={alwaysOnTop}
              onClick={onToggleAlwaysOnTop}
            />
          ) : null}

          <Menu
            items={[
              ...(onOpenApp ? [{ label: 'Open Recall', icon: 'inbox' as const, onSelect: onOpenApp }] : []),
              ...extraMenuItems.map((item) => ({ ...item, separatorBefore: true })),
              ...(onHide
                ? [{ label: 'Hide widget', icon: 'close' as const, onSelect: onHide, separatorBefore: true }]
                : []),
            ]}
            trigger={(props) => <IconButton icon="more" label="Widget menu" size={13} {...props} />}
          />
        </span>
      </header>

      <div className={styles.widgetBody}>
        <AuthGate compact>
          <TaskListView
            variant="widget"
            showCompleted={preferences.showCompleted}
            autoFocusCapture
            captureRef={captureRef}
            onEscape={onHide}
          />
        </AuthGate>
      </div>

      {footer ? <div className={styles.widgetFooter}>{footer}</div> : null}
    </div>
  );
}
