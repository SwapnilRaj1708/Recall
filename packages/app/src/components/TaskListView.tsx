import type { Task } from '@recall/core';
import { EmptyState, Icon, QuickAdd, TaskRow, cx, useToast, type QuickAddHandle } from '@recall/ui';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTaskActions, useTasks, useUnsyncedIds } from '../context.js';
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

interface DropTarget {
  id: string;
  half: 'before' | 'after';
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

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const internalCaptureRef = useRef<QuickAddHandle>(null);

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

  const handleDrop = useCallback(() => {
    const target = dropTarget;
    const sourceId = draggingId;
    setDraggingId(null);
    setDropTarget(null);
    if (!target || !sourceId || target.id === sourceId) return;

    const withoutSource = visibleOpen.filter((t) => t.id !== sourceId);
    const anchorIndex = withoutSource.findIndex((t) => t.id === target.id);
    if (anchorIndex < 0) return;

    const index = target.half === 'before' ? anchorIndex : anchorIndex + 1;
    void actions.moveToIndex(sourceId, index, visibleOpen);
  }, [actions, draggingId, dropTarget, visibleOpen]);

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

      <div className={cx(styles.scroller, 'rc-scroll')} onDragEnd={() => setDraggingId(null)}>
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
          <ul className={styles.list}>
            {visibleOpen.map((task) => (
              <TaskRow
                key={task.id}
                id={task.id}
                text={task.text}
                completed={false}
                compact={compact}
                draggable={canReorder}
                dragging={draggingId === task.id}
                unsynced={unsynced.has(task.id)}
                dropIndicator={dropTarget?.id === task.id ? dropTarget.half : null}
                meta={compact ? undefined : relativeTime(task.createdAt)}
                onToggle={(next) => void actions.setCompleted(task.id, next)}
                onEdit={(text) => void actions.setText(task.id, text)}
                onDelete={() => handleDelete(task)}
                onDragStart={() => setDraggingId(task.id)}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDropTarget(null);
                }}
                onDragOverHalf={
                  canReorder && draggingId
                    ? (half) => setDropTarget({ id: task.id, half })
                    : undefined
                }
                onDrop={canReorder && draggingId ? handleDrop : undefined}
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
