import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Icon } from './Icon.js';
import { Kbd, cx } from './primitives.js';
import styles from './task.module.css';

export interface QuickAddHandle {
  focus: () => void;
  clear: () => void;
}

export interface QuickAddProps {
  onSubmit: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Escape hands control back to the host — hide the widget, close the popup. */
  onEscape?: () => void;
  showHint?: boolean;
  className?: string;
}

/**
 * The capture field.
 *
 * This is the most important control in the product, so it optimises for one
 * thing: the shortest possible path from a thought to a stored task. It keeps
 * focus after submitting, so three thoughts in a row cost three Enters and no
 * clicks, and it never blocks on the network — `onSubmit` returns immediately
 * and the sync engine deals with delivery.
 */
export const QuickAdd = forwardRef<QuickAddHandle, QuickAddProps>(function QuickAdd(
  { onSubmit, placeholder = 'What do you need to remember?', autoFocus, onEscape, showHint = true, className },
  ref,
) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    clear: () => setValue(''),
  }));

  const submit = () => {
    const text = value.trim();
    if (text.length === 0) return;
    // Clear first so the field is ready for the next thought immediately.
    setValue('');
    onSubmit(text);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      // First Escape clears a half-typed thought; a second one leaves.
      if (value.length > 0) setValue('');
      else onEscape?.();
    }
  };

  return (
    <div className={cx(styles.quickAdd, className)}>
      <span className={styles.quickAddIcon}>
        <Icon name="plus" size={15} />
      </span>
      <input
        ref={inputRef}
        className={styles.quickAddInput}
        value={value}
        placeholder={placeholder}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the entire point of the surface
        autoFocus={autoFocus}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Add a task"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
      />
      {showHint && value.length > 0 ? (
        <span className={styles.quickAddHint}>
          <Kbd>Enter</Kbd>
        </span>
      ) : null}
    </div>
  );
});
