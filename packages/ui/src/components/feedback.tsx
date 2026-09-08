import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './Icon.js';
import { Button, IconButton, cx } from './primitives.js';
import styles from './feedback.module.css';

/* ------------------------------------------------------------------- modal */

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, title, onClose, children, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={title}>
        <header className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{title}</h2>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </header>
        <div className={cx(styles.modalBody, 'rc-scroll')}>{children}</div>
        {footer ? <footer className={styles.modalFooter}>{footer}</footer> : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- menu */

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export interface MenuProps {
  items: MenuItem[];
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean }) => ReactNode;
  align?: 'left' | 'right';
}

export function Menu({ items, trigger, align = 'right' }: MenuProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.menuAnchor} ref={anchorRef}>
      {trigger({ onClick: () => setOpen((v) => !v), 'aria-expanded': open })}
      {open ? (
        <div className={cx(styles.menu, align === 'left' && styles.menuLeft)} role="menu">
          {items.map((item, index) => (
            <div key={item.label}>
              {item.separatorBefore && index > 0 ? (
                <div className={styles.menuSeparator} role="separator" />
              ) : null}
              <button
                type="button"
                role="menuitem"
                className={cx(styles.menuItem, item.danger && styles.menuItemDanger)}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon ? <Icon name={item.icon} size={14} /> : null}
                {item.label}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ toasts */

export interface Toast {
  id: number;
  message: string;
  tone?: 'default' | 'error';
  action?: { label: string; onSelect: () => void };
  durationMs?: number;
}

interface ToastContextValue {
  /**
   * Show a transient message. The `action` slot is what makes destructive
   * operations safe to perform without a confirmation dialog: delete acts
   * immediately and offers Undo, rather than interrupting with "are you sure".
   */
  toast: (toast: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: Omit<Toast, 'id'>) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-2), { ...input, id }]);
      const duration = input.durationMs ?? (input.tone === 'error' ? 6_000 : 4_000);
      setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.toaster} role="status" aria-live="polite">
        {toasts.map((item) => (
          <div
            key={item.id}
            className={cx(styles.toast, item.tone === 'error' && styles.toastError)}
          >
            <span className={styles.toastMessage}>{item.message}</span>
            {item.action ? (
              <button
                type="button"
                className={styles.toastAction}
                onClick={() => {
                  item.action?.onSelect();
                  dismiss(item.id);
                }}
              >
                {item.action.label}
              </button>
            ) : (
              <IconButton icon="close" label="Dismiss" onClick={() => dismiss(item.id)} />
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  // A no-op fallback keeps components usable outside a provider (the widget's
  // quick-capture window has no toaster) without every caller null-checking.
  return context ?? { toast: () => {} };
}

/* ------------------------------------------------------------------ states */

export interface StateProps {
  icon?: IconName;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon = 'inbox', title, body, action, compact }: StateProps) {
  return (
    <div className={cx(styles.state, compact && styles.stateCompact)}>
      <span className={styles.stateIcon}>
        <Icon name={icon} size={compact ? 20 : 26} />
      </span>
      <span className={styles.stateTitle}>{title}</span>
      {body ? <span className={styles.stateBody}>{body}</span> : null}
      {action}
    </div>
  );
}

export interface ErrorStateProps extends StateProps {
  onRetry?: () => void;
}

export function ErrorState({ title, body, onRetry, compact }: ErrorStateProps) {
  return (
    <div className={cx(styles.state, styles.stateError, compact && styles.stateCompact)}>
      <span className={styles.stateIcon}>
        <Icon name="alert" size={compact ? 20 : 26} />
      </span>
      <span className={styles.stateTitle}>{title}</span>
      {body ? <span className={styles.stateBody}>{body}</span> : null}
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className={styles.skeletonList} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div className={styles.skeletonRow} key={index}>
          <div className={cx(styles.skeletonBox, styles.skeletonCheck)} />
          <div
            className={styles.skeletonBox}
            style={{ width: `${[68, 46, 78, 55, 62][index % 5]}%` }}
          />
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- sync badge */

export interface SyncBadgeProps {
  online: boolean;
  live: boolean;
  syncing: boolean;
  pending: number;
  failed: number;
  lastSyncedAt: string | null;
  error: string | null;
  onClick?: () => void;
  /** Widget mode: show the dot alone unless something needs attention. */
  compact?: boolean;
}

/**
 * A single, quiet indicator of whether the list on screen is the real list.
 *
 * It stays silent while everything is fine — a permanently visible "synced"
 * badge is noise — and only speaks up when there is something queued, failing,
 * or offline.
 */
export function SyncBadge({
  online,
  live,
  syncing,
  pending,
  failed,
  lastSyncedAt,
  error,
  onClick,
  compact = false,
}: SyncBadgeProps) {
  const state = !online
    ? { tone: 'warn' as const, icon: 'cloud-off' as IconName, text: 'Offline' }
    : failed > 0
      ? { tone: 'error' as const, icon: 'alert' as IconName, text: `${failed} not saved` }
      : error
        ? { tone: 'warn' as const, icon: 'cloud-off' as IconName, text: 'Sync problem' }
        : syncing
          ? { tone: 'idle' as const, icon: 'cloud' as IconName, text: 'Syncing' }
          : pending > 0
            ? { tone: 'warn' as const, icon: 'cloud' as IconName, text: `${pending} pending` }
            : { tone: 'idle' as const, icon: null, text: live ? 'Synced' : 'Connecting' };

  const title = error
    ? error
    : lastSyncedAt
      ? `Last synced ${new Date(lastSyncedAt).toLocaleTimeString()}`
      : 'Not synced yet';

  const quiet = state.tone === 'idle' && pending === 0 && failed === 0;
  if (compact && quiet) {
    return (
      <span className={styles.syncBadge} title={title}>
        <span className={cx(styles.dot, live && styles.dotLive)} />
      </span>
    );
  }

  const Element = onClick ? 'button' : 'span';
  return (
    <Element
      className={cx(
        styles.syncBadge,
        onClick && styles.syncBadgeButton,
        state.tone === 'warn' && styles.syncBadgeWarn,
        state.tone === 'error' && styles.syncBadgeError,
      )}
      title={title}
      {...(onClick ? { type: 'button' as const, onClick } : {})}
    >
      {state.icon ? (
        <Icon name={state.icon} size={13} className={syncing ? styles.spinning : undefined} />
      ) : (
        <span className={cx(styles.dot, live && styles.dotLive)} />
      )}
      {state.text}
    </Element>
  );
}
