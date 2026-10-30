import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { splitLinks } from '../links.js';
import { Icon } from './Icon.js';
import { Checkbox, IconButton, Kbd, cx } from './primitives.js';
import styles from './task.module.css';

export interface TaskRowProps {
  id: string;
  text: string;
  completed: boolean;
  /** Widget mode: clamp long text and hide the metadata column. */
  compact?: boolean;
  /** Show the drag handle. Reordering is off in filtered or searched views. */
  draggable?: boolean;
  meta?: ReactNode;
  dropIndicator?: 'before' | 'after' | null;
  dragging?: boolean;
  /** Still only on this device: captured offline, or not yet pushed. */
  unsynced?: boolean;

  onToggle: (completed: boolean) => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOverHalf?: (half: 'before' | 'after') => void;
  onDrop?: () => void;
}

export function TaskRow({
  text,
  completed,
  compact = false,
  draggable = false,
  meta,
  dropIndicator = null,
  dragging = false,
  unsynced = false,
  onToggle,
  onEdit,
  onDelete,
  onDragStart,
  onDragEnd,
  onDragOverHalf,
  onDrop,
}: TaskRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const inputRef = useRef<HTMLInputElement>(null);
  const segments = useMemo(() => splitLinks(text), [text]);

  // If the task changes underneath an open editor — a sync from another device —
  // leave the in-progress draft alone rather than yanking the text away
  // mid-sentence. The merge will reconcile whichever edit lands last.
  useEffect(() => {
    if (!editing) setDraft(text);
  }, [text, editing]);

  useLayoutEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next.length > 0 && next !== text) onEdit(next);
    else setDraft(text);
  };

  const cancel = () => {
    setDraft(text);
    setEditing(false);
  };

  const onEditKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  };

  return (
    <li
      className={cx(
        styles.row,
        dragging && styles.rowDragging,
        dropIndicator === 'before' && styles.rowDropBefore,
        dropIndicator === 'after' && styles.rowDropAfter,
        unsynced && styles.rowUnsynced,
      )}
      // Announced, not just coloured: colour alone would leave this invisible
      // to a screen reader and to anyone who cannot distinguish the tone.
      aria-describedby={unsynced ? 'rc-unsynced-hint' : undefined}
      onDragOver={
        onDragOverHalf
          ? (event) => {
              event.preventDefault();
              const box = event.currentTarget.getBoundingClientRect();
              onDragOverHalf(event.clientY < box.top + box.height / 2 ? 'before' : 'after');
            }
          : undefined
      }
      onDrop={
        onDrop
          ? (event) => {
              event.preventDefault();
              onDrop();
            }
          : undefined
      }
    >
      {draggable ? (
        <span
          className={styles.handle}
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          aria-hidden="true"
        >
          <Icon name="grip" size={14} />
        </span>
      ) : null}

      <Checkbox
        checked={completed}
        onChange={onToggle}
        label={completed ? `Mark "${text}" as not done` : `Mark "${text}" as done`}
      />

      {editing ? (
        <input
          ref={inputRef}
          className={styles.editInput}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onEditKeyDown}
          // Clicking away keeps the edit rather than discarding it; losing typed
          // text is exactly the failure this app exists to prevent.
          onBlur={commit}
          aria-label="Edit task"
        />
      ) : (
        /*
          Two layers, so a link can sit inside text that is itself a control.

          A link cannot go inside the edit button — interactive content inside
          a button is invalid, and browsers disagree about which one a click
          reaches. So the button is an empty layer filling the cell, and the
          text is drawn over it with pointer events off: a click on the words
          falls through to the button and starts an edit, while a click on a
          link lands on the link.

          Nothing here may stop or cancel the link's click. In the desktop and
          phone apps it is the opener plugin's listener on `window` that sends
          a `_blank` link to the real browser, and it ignores any click that
          was cancelled — and React's stopPropagation would keep it from ever
          reaching `window` at all.
        */
        <span className={styles.textCell}>
          <button
            type="button"
            className={styles.editHit}
            onClick={() => setEditing(true)}
            title="Click to edit"
            aria-label={`Edit "${text}"`}
          />
          <span
            className={cx(
              styles.text,
              compact && styles.textClamped,
              completed && styles.textCompleted,
            )}
          >
            {segments.map((segment, index) =>
              segment.kind === 'link' ? (
                <a
                  key={index}
                  className={styles.link}
                  href={segment.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {segment.text}
                </a>
              ) : (
                <Fragment key={index}>{segment.text}</Fragment>
              ),
            )}
          </span>
        </span>
      )}

      {!editing && meta && !compact ? <span className={styles.meta}>{meta}</span> : null}

      {!editing ? (
        <span className={styles.actions}>
          <IconButton icon="trash" label={`Delete "${text}"`} tone="danger" onClick={onDelete} />
        </span>
      ) : (
        <span className={styles.actions}>
          <Kbd>Enter</Kbd>
        </span>
      )}
    </li>
  );
}
