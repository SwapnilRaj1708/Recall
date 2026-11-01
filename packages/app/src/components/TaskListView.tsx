import type { Task } from '@recall/core';
import { EmptyState, Icon, QuickAdd, TaskRow, cx, useToast, type QuickAddHandle } from '@recall/ui';
import { useCallback, useMemo, useRef } from 'react';
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
  const { open, completed } = useTasks();
  const actions = useTaskActions();
  const unsynced = useUnsyncedIds();
  const { toast } = useToast();
  const compact = variant === 'widget';

  const internalCaptureRef = useRef<QuickAddHandle>(null);
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
                draggable={canReorder}
                unsynced={unsynced.has(task.id)}
                meta={compact ? undefined : relativeTime(task.createdAt)}
                onToggle={(next) => void actions.setCompleted(task.id, next)}
                onEdit={(text) => void actions.setText(task.id, text)}
                onDelete={() => handleDelete(task)}
                onReorderStart={canReorder ? (event) => startReorder(task.id, event) : undefined}
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
