import type { Task } from '@recall/core';
import {
  EmptyState,
  Icon,
  IconButton,
  QuickAdd,
  TaskRow,
  cx,
  haptic,
  useToast,
  type QuickAddHandle,
} from '@recall/ui';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTaskActions, useTasks, useUnsyncedIds } from '../context.js';
import { useListFlip, useReorder } from './listMotion.js';
import styles from './TaskListView.module.css';

export interface TaskListViewProps {
  variant?: 'widget' | 'full';
  /** Free-text filter. Reordering is disabled while it is active. */
  search?: string;
  showCompleted?: boolean;
  autoFocusCapture?: boolean;
  /** Escape from the capture field with nothing typed — used by the widget to hide. */
  onEscape?: () => void;
  captureRef?: React.Ref<QuickAddHandle>;
}

export function TaskListView({
  variant = 'full',
  search = '',
  showCompleted = false,
  autoFocusCapture = false,
  onEscape,
  captureRef,
}: TaskListViewProps) {
  const { open, completed, saved } = useTasks();
  const actions = useTaskActions();
  const unsynced = useUnsyncedIds();
  const { toast } = useToast();
  const compact = variant === 'widget';

  const internalCaptureRef = useRef<QuickAddHandle>(null);
  /** The working list, or the Saved folder opened from the button beside the field. */
  const [view, setView] = useState<'list' | 'saved'>('list');
  const listRef = useRef<HTMLUListElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const query = search.trim().toLowerCase();
  const matches = useCallback(
    (task: Task) => query.length === 0 || task.text.toLowerCase().includes(query),
    [query],
  );

  const visibleOpen = useMemo(() => open.filter(matches), [open, matches]);
  const visibleCompleted = useMemo(
    () => (showCompleted ? completed.filter(matches) : []),
    [completed, showCompleted, matches],
  );
  const visibleSaved = useMemo(() => saved.filter(matches), [saved, matches]);

  const handleSave = useCallback(
    (task: Task, text?: string) => {
      void actions.save(task.id, text);
      toast({
        message: 'Saved',
        action: { label: 'Undo', onSelect: () => void actions.unsave(task.id) },
      });
    },
    [actions, toast],
  );

  // A drag reorders the canonical list, so it only makes sense when the whole
  // list is on screen. Filtered views show the handle disabled instead.
  const canReorder = query.length === 0;

  const handleCapture = useCallback(
    (text: string) => {
      void actions.capture(text);
    },
    [actions],
  );

  const handleDelete = useCallback(
    (task: Task) => {
      void actions.remove(task.id);
      // Delete acts immediately and offers Undo rather than interrupting with a
      // confirmation. The tombstone makes the undo real, not cosmetic.
      toast({
        message: `Deleted "${truncate(task.text)}"`,
        action: { label: 'Undo', onSelect: () => void actions.restore(task.id) },
      });
    },
    [actions, toast],
  );

  const order = useMemo(() => visibleOpen.map((task) => task.id).join(' '), [visibleOpen]);

  // Declared before the slide animation, so on a committed reorder the drag's
  // transforms are cleared before the slide measures where rows ended up.
  const recordPositions = useRef<() => void>(() => {});
  const animating = useRef(new Set<string>());
  const startReorder = useReorder({
    listRef,
    scrollerRef,
    order,
    onBeforeCommit: () => recordPositions.current(),
    commit: (id, index) => void actions.moveToIndex(id, index, visibleOpen),
    animating,
  });
  recordPositions.current = useListFlip(listRef, order, animating);

  // The scroll-edge fade appears only while something is scrolled out of view.
  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const scroller = event.currentTarget;
    scroller.dataset.scrolled = String(scroller.scrollTop > 0);
  }, []);

  /*
   * Hold anywhere on a row to drag it — the handle is gone, its space now
   * holds the save button. A press becomes a drag only after it has been held
   * still for a moment, so a tap still edits, a press on a button or link is
   * left alone, and a finger that starts moving is scrolling, not dragging.
   */
  const pressRef = useRef<{ cancel: () => void } | null>(null);
  const swallowClick = useRef(false);
  const onPressStart = useCallback(
    (id: string, event: ReactPointerEvent<HTMLElement>) => {
      if (!canReorder || event.button !== 0) return;
      const target = event.target as HTMLElement;
      // The task's own text (its edit layer) and empty row space lift it;
      // the checkbox, buttons, links and menus keep their own presses.
      if (target.closest('a, input, [role="menu"], button:not([class*="editHit"])')) return;
      const row = event.currentTarget;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let lastY = startY;

      const cleanup = () => {
        clearTimeout(timer);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', cleanup);
        window.removeEventListener('pointercancel', cleanup);
        pressRef.current = null;
      };
      const onMove = (move: PointerEvent) => {
        lastY = move.clientY;
        if (Math.hypot(move.clientX - startX, move.clientY - startY) > 8) cleanup();
      };
      const timer = setTimeout(() => {
        cleanup();
        haptic('medium');
        // The release after a drag would otherwise reach the row as a click
        // and open the editor.
        swallowClick.current = true;
        startReorder(id, {
          button: 0,
          clientY: lastY,
          pointerId,
          currentTarget: row,
          preventDefault: () => {},
        } as unknown as ReactPointerEvent<HTMLElement>);
      }, HOLD_MS);

      pressRef.current?.cancel();
      pressRef.current = { cancel: cleanup };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', cleanup);
      window.addEventListener('pointercancel', cleanup);
    },
    [canReorder, startReorder],
  );

  // While a row is held for dragging, the page must not scroll under the
  // finger, and the release must not count as a tap.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onTouchMove = (event: TouchEvent) => {
      if (list.dataset.reordering === 'true') event.preventDefault();
    };
    const onClick = (event: MouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    };
    list.addEventListener('touchmove', onTouchMove, { passive: false });
    list.addEventListener('click', onClick, true);
    return () => {
      list.removeEventListener('touchmove', onTouchMove);
      list.removeEventListener('click', onClick, true);
    };
  });

  const savedButton = (
    <IconButton
      icon="saved"
      label={view === 'saved' ? 'Back to the list' : `Saved (${saved.length})`}
      title={view === 'saved' ? 'Back to the list' : `Saved — ${saved.length}`}
      className={cx(styles.savedButton, view === 'saved' && 'rc-toggle-on')}
      onClick={() => setView((current) => (current === 'saved' ? 'list' : 'saved'))}
    />
  );

  if (view === 'saved') {
    return (
      <div className={cx(styles.container, compact && styles.containerCompact)}>
        <div className={cx(styles.capture, styles.savedHeader)}>
          <IconButton icon="back" label="Back to the list" onClick={() => setView('list')} />
          <span className={styles.savedTitle}>Saved</span>
          <span className={styles.sectionCount}>{saved.length}</span>
          <span className={styles.savedSpacer} />
          {savedButton}
        </div>
        <div className={cx(styles.scroller, 'rc-scroll')} onScroll={onScroll}>
          {visibleSaved.length === 0 ? (
            <EmptyState
              icon="saved"
              title={query.length > 0 ? 'No matches' : 'Nothing saved yet'}
              body={
                query.length > 0
                  ? `Nothing saved contains "${search.trim()}".`
                  : 'Tap the bookmark beside a task to keep it here.'
              }
              compact={compact}
            />
          ) : (
            <ul className={styles.list}>
              {visibleSaved.map((task) => (
                <TaskRow
                  key={task.id}
                  id={task.id}
                  text={task.text}
                  completed={false}
                  compact={compact}
                  meta={compact ? undefined : relativeTime(task.savedAt ?? task.updatedAt)}
                  onToggle={() => {}}
                  onEdit={(text) => void actions.setText(task.id, text)}
                  onDelete={() => handleDelete(task)}
                  onUnsave={() => void actions.unsave(task.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  const isEmpty = visibleOpen.length === 0 && visibleCompleted.length === 0;

  return (
    <div className={cx(styles.container, compact && styles.containerCompact)}>
      <QuickAdd
        ref={captureRef ?? internalCaptureRef}
        onSubmit={handleCapture}
        autoFocus={autoFocusCapture}
        onEscape={onEscape}
        placeholder={compact ? 'Add a task…' : 'What do you need to remember?'}
        className={styles.capture}
        trailing={savedButton}
      />

      <div ref={scrollerRef} className={cx(styles.scroller, 'rc-scroll')} onScroll={onScroll}>
        {isEmpty ? (
          query.length > 0 ? (
            <EmptyState
              icon="search"
              title="No matches"
              body={`Nothing here contains "${search.trim()}".`}
              compact={compact}
            />
          ) : (
            <EmptyState
              title="Nothing to remember"
              body={
                compact
                  ? 'Type above to capture a thought.'
                  : 'Type in the field above, or press the global shortcut from anywhere.'
              }
              compact={compact}
            />
          )
        ) : null}

        {/*
          What the marked rows point at. One node for the list rather than one
          per row: the text is identical, and a screen reader announcing it
          once per task would be worse than not saying it at all.
        */}
        {unsynced.size > 0 ? (
          <span id="rc-unsynced-hint" className="rc-sr-only">
            Not synced yet — saved on this device only
          </span>
        ) : null}

        {visibleOpen.length > 0 ? (
          <ul ref={listRef} className={styles.list}>
            {visibleOpen.map((task) => (
              <TaskRow
                key={task.id}
                id={task.id}
                text={task.text}
                completed={false}
                compact={compact}
                unsynced={unsynced.has(task.id)}
                meta={compact ? undefined : relativeTime(task.createdAt)}
                onToggle={(next) => void actions.setCompleted(task.id, next)}
                onEdit={(text) => void actions.setText(task.id, text)}
                onDelete={() => handleDelete(task)}
                onPressStart={(event) => onPressStart(task.id, event)}
                onSave={() => handleSave(task)}
                onSaveAs={(text) => handleSave(task, text)}
              />
            ))}
          </ul>
        ) : null}

        {visibleCompleted.length > 0 ? (
          <>
            <div className={styles.sectionHeader}>
              <Icon name="check" size={12} />
              Done
              <span className={styles.sectionCount}>{visibleCompleted.length}</span>
            </div>
            <ul className={styles.list}>
              {visibleCompleted.map((task) => (
                <TaskRow
                  key={task.id}
                  id={task.id}
                  text={task.text}
                  completed
                  compact={compact}
                  meta={compact ? undefined : relativeTime(task.completedAt ?? task.updatedAt)}
                  onToggle={(next) => void actions.setCompleted(task.id, next)}
                  onEdit={(text) => void actions.setText(task.id, text)}
                  onDelete={() => handleDelete(task)}
                />
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** How long a row must be held still before it lifts for dragging. */
const HOLD_MS = 380;

function truncate(text: string, max = 32): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Coarse relative time. Precision is not useful here — the question a glance
 * answers is "is this old?", not "how old exactly?".
 */
export function relativeTime(iso: string): string {
  const elapsed = Date.now() - Date.parse(iso);
  if (!Number.isFinite(elapsed)) return '';
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
