import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  SPRINGS,
  Spring,
  VelocityTracker,
  haptic,
  prefersReducedMotion,
  project,
  rubberband,
  usePresence,
} from '../motion.js';
import { Icon, type IconName } from './Icon.js';
import { Button, IconButton, cx } from './primitives.js';
import styles from './feedback.module.css';

/** Long enough for the slowest exit — the spring easing's settle time — to finish. */
const EXIT_MS = 560;

function useMediaQuery(query: string): boolean {
  const get = () => typeof matchMedia === 'function' && matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const list = matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/* ------------------------------------------------------------------- modal */

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** Narrow screens get a sheet from the bottom edge, which a thumb can reach and pull down. */
const SHEET_QUERY = '(max-width: 560px)';

/** Below this projected travel, a released sheet springs back rather than closing. */
const DISMISS_FRACTION = 0.5;

/**
 * A modal task: dims the background and takes focus until dismissed.
 *
 * On a wide screen it is a card that grows out of the control that opened it
 * and shrinks back into it — the same path in and out. On a phone it is a
 * sheet: it rises from the bottom edge, and it can be taken hold of by its top
 * and pulled down. The sheet tracks the finger 1:1, the dimming follows it,
 * and on release it goes wherever the flick was heading — closed if it would
 * have travelled past halfway, back up otherwise — continuing at the speed the
 * finger left it. Grab it again mid-flight and it stops in your hand.
 */
export function Modal({ open, title, onClose, children, footer }: ModalProps) {
  const { mounted, state } = usePresence(open, EXIT_MS);
  const sheet = useMediaQuery(SHEET_QUERY);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    // Whatever opened this — the focused button — is where it grows from.
    const trigger = document.activeElement;
    if (trigger instanceof HTMLElement && trigger !== document.body) {
      const box = trigger.getBoundingClientRect();
      originRef.current = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const origin = originRef.current;
    if (!mounted || !panel || sheet || !origin) return;
    const box = panel.getBoundingClientRect();
    panel.style.transformOrigin = `${origin.x - box.left}px ${origin.y - box.top}px`;
  }, [mounted, sheet]);

  const drag = useSheetDrag(panelRef, scrimRef, onClose, sheet && open);

  if (!mounted) return null;

  return (
    <div className={cx(styles.overlay, sheet && styles.overlaySheet)} data-state={state}>
      <div ref={scrimRef} className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={cx(styles.modal, sheet && styles.sheet, 'rc-material')}
        data-state={state}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {sheet ? (
          <div className={styles.grabber} onPointerDown={drag} aria-hidden="true">
            <span className={styles.grabberBar} />
          </div>
        ) : null}
        <header className={styles.modalHeader} onPointerDown={sheet ? drag : undefined}>
          <h2 className={styles.modalTitle}>{title}</h2>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </header>
        <div className={cx(styles.modalBody, 'rc-scroll')}>{children}</div>
        {footer ? <footer className={styles.modalFooter}>{footer}</footer> : null}
      </div>
    </div>
  );
}

/**
 * Pulling a sheet down by its top.
 *
 * While held, the sheet is moved directly, frame by frame, and the CSS
 * transition is suspended so nothing lags the finger. On release a spring
 * takes over from exactly where it is, with the finger's velocity, so there
 * is no seam between dragging and animating.
 */
function useSheetDrag(
  panelRef: React.RefObject<HTMLDivElement | null>,
  scrimRef: React.RefObject<HTMLDivElement | null>,
  onClose: () => void,
  enabled: boolean,
) {
  const springRef = useRef<Spring | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const apply = useCallback(
    (offset: number) => {
      const panel = panelRef.current;
      const scrim = scrimRef.current;
      if (!panel) return;
      const height = panel.offsetHeight || 1;
      panel.style.transition = 'none';
      panel.style.transform = `translateY(${offset}px)`;
      if (scrim) {
        scrim.style.transition = 'none';
        scrim.style.opacity = String(1 - Math.min(1, Math.max(0, offset / height)));
      }
    },
    [panelRef, scrimRef],
  );

  /** Hand the sheet back to its stylesheet, which by now agrees with where it is. */
  const release = useCallback(() => {
    for (const element of [panelRef.current, scrimRef.current]) {
      if (!element) continue;
      element.style.transition = '';
      element.style.transform = '';
      element.style.opacity = '';
    }
  }, [panelRef, scrimRef]);

  useEffect(() => () => springRef.current?.stop(), []);

  return useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const panel = panelRef.current;
      if (!enabled || !panel || event.button !== 0) return;
      if ((event.target as HTMLElement).closest('button')) return;

      springRef.current ??= new Spring(0, apply);
      const spring = springRef.current;
      // Caught mid-flight: carry on from exactly where it is on screen.
      spring.stop();
      const startOffset = spring.value;
      const startY = event.clientY;
      const height = panel.offsetHeight;
      const tracker = new VelocityTracker();
      tracker.add(startOffset);
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      const onMove = (move: PointerEvent) => {
        const raw = startOffset + (move.clientY - startY);
        // Upwards there is nothing more, so it gives way less and less.
        const offset = raw < 0 ? rubberband(raw, height) : raw;
        tracker.add(offset);
        spring.jump(offset);
      };

      const onUp = () => {
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        target.removeEventListener('pointercancel', onUp);
        const velocity = tracker.velocity();
        const projected = spring.value + project(velocity);
        if (projected > height * DISMISS_FRACTION) {
          haptic();
          spring.to(height, SPRINGS.drawer, {
            velocity,
            onRest: () => {
              onCloseRef.current();
              // The closed style puts it exactly here, so this changes nothing on screen.
              release();
              spring.jump(0);
            },
          });
        } else {
          spring.to(0, SPRINGS.drawer, { velocity, onRest: release });
        }
      };

      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
      target.addEventListener('pointercancel', onUp);
    },
    [apply, enabled, panelRef, release],
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

/**
 * Grows out of the button that opened it, from the corner nearest that
 * button, and shrinks back into it. Opening and closing are one transition
 * run in either direction, so a second tap mid-opening simply turns it round.
 */
export function Menu({ items, trigger, align = 'right' }: MenuProps) {
  const [open, setOpen] = useState(false);
  const { mounted, state } = usePresence(open, EXIT_MS);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.menuAnchor} ref={anchorRef}>
      {trigger({ onClick: () => setOpen((v) => !v), 'aria-expanded': open })}
      {mounted ? (
        <div
          className={cx(styles.menu, align === 'left' && styles.menuLeft, 'rc-material')}
          data-state={state}
          role="menu"
        >
          {items.map((item, index) => (
            <div key={item.label}>
              {item.separatorBefore && index > 0 ? (
                <div className={styles.menuSeparator} role="separator" />
              ) : null}
              <button
                type="button"
                role="menuitem"
                className={cx(styles.menuItem, item.danger && styles.menuItemDanger)}
                disabled={item.disabled || state === 'closed'}
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

/** How long a dismissed toast takes to leave, the way it came in. */
const TOAST_EXIT_MS = 320;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<(Toast & { leaving?: boolean })[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    // Out along the path it came in on, then gone.
    setToasts((current) => current.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(
      () => setToasts((current) => current.filter((t) => t.id !== id)),
      prefersReducedMotion() ? 0 : TOAST_EXIT_MS,
    );
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
            className={cx(
              styles.toast,
              'rc-material',
              item.tone === 'error' && styles.toastError,
              item.leaving && styles.toastLeaving,
            )}
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
