import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { haptic } from '../motion.js';
import { splitLinks } from '../links.js';
import { Icon } from './Icon.js';
import { Menu } from './feedback.js';
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
  /** Still only on this device: captured offline, or not yet pushed. */
  unsynced?: boolean;

  onToggle: (completed: boolean) => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
  /**
   * A press began somewhere on the row. The list decides whether it becomes a
   * hold-to-drag; see listMotion. Replaces the old drag handle, which took up
   * the space the save button now uses.
   */
  onPressStart?: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Move to the Saved folder as it is. */
  onSave?: () => void;
  /** Move to the Saved folder with the text rewritten first. */
  onSaveAs?: (text: string) => void;
  /** In the Saved folder: move back to the working list. */
  onUnsave?: () => void;
}

export function TaskRow({
  id,
  text,
  completed,
  compact = false,
  meta,
  unsynced = false,
  onToggle,
  onEdit,
  onDelete,
  onPressStart,
  onSave,
  onSaveAs,
  onUnsave,
}: TaskRowProps) {
  const [editing, setEditing] = useState(false);
  /** Editing for "Save As": Enter saves the rewritten task instead of only editing it. */
  const [savingAs, setSavingAs] = useState(false);
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
    setSavingAs(false);
    if (next.length > 0 && next !== text) onEdit(next);
    else setDraft(text);
  };

  const cancel = () => {
    setDraft(text);
    setEditing(false);
    setSavingAs(false);
  };

  const onEditKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (savingAs) {
        const next = draft.trim();
        setEditing(false);
        setSavingAs(false);
        haptic();
        onSaveAs?.(next.length > 0 ? next : text);
        return;
      }
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  };

  const startSaveAs = () => {
    setDraft(text);
    setSavingAs(true);
    setEditing(true);
  };

  return (
    <li
      className={cx(styles.row, unsynced && styles.rowUnsynced)}
      data-task-id={id}
      // Announced, not just coloured: colour alone would leave this invisible
      // to a screen reader and to anyone who cannot distinguish the tone.
      aria-describedby={unsynced ? 'rc-unsynced-hint' : undefined}
      onPointerDown={onPressStart}
    >
      {onSave ? (
        // Where the drag handle used to be: dragging is now a hold anywhere
        // on the row, which frees this space for saving.
        <span className={styles.leading}>
          <Menu
            align="left"
            items={[
              {
                label: 'Save',
                icon: 'bookmark',
                onSelect: () => {
                  haptic();
                  onSave();
                },
              },
              { label: 'Save As…', icon: 'bookmark', onSelect: startSaveAs },
            ]}
            trigger={({ onClick, 'aria-expanded': expanded }) => (
              <IconButton
                icon="bookmark"
                label={`Save "${text}"`}
                aria-expanded={expanded}
                onClick={onClick}
                className={styles.saveButton}
              />
            )}
          />
        </span>
      ) : null}

      {onUnsave ? (
        <span className={styles.leading}>
          <IconButton
            icon="undo"
            label={`Move "${text}" back to the list`}
            title="Move back to the list"
            onClick={onUnsave}
            className={styles.saveButton}
          />
        </span>
      ) : null}

      {onUnsave ? null : <Checkbox
        checked={completed}
        // Completing is a commit, so it gets a tap of the motor on a phone,
        // in the same frame as the box filling in.
        onChange={(next) => {
          if (next) haptic();
          onToggle(next);
        }}
        label={completed ? `Mark "${text}" as not done` : `Mark "${text}" as done`}
      />}

      {editing ? (
        <input
          ref={inputRef}
          className={cx(styles.editInput, savingAs && styles.editInputSaving)}
          placeholder={savingAs ? 'Rewrite it, then Enter to save' : undefined}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onEditKeyDown}
          // Clicking away keeps the edit rather than discarding it; losing typed
          // text is exactly the failure this app exists to prevent.
          onBlur={commit}
          aria-label={savingAs ? 'Rewrite, then press Enter to save' : 'Edit task'}
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
          {savingAs ? <span className={styles.savingHint}>Save</span> : null}
          <Kbd>Enter</Kbd>
        </span>
      )}
    </li>
  );
}
