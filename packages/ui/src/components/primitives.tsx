import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './Icon.js';
import styles from './primitives.module.css';

export const cx = (...values: (string | false | null | undefined)[]): string =>
  values.filter(Boolean).join(' ');

/* -------------------------------------------------------------------------- */

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  /** Translucent, blurred panel — used where the desktop shows through. */
  glass?: boolean;
  elevation?: 'flat' | 'low' | 'high';
  children?: ReactNode;
}

export function Surface({
  glass = false,
  elevation = 'low',
  className,
  children,
  ...rest
}: SurfaceProps) {
  return (
    <div
      className={cx(
        styles.surface,
        glass && 'rc-glass',
        elevation === 'high' && styles.surfaceRaised,
        elevation === 'flat' && styles.surfaceFlat,
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, block, className, children, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      // Buttons inside forms default to submit, which has surprised enough
      // people that being explicit is worth the line.
      type={type ?? 'button'}
      className={cx(
        styles.button,
        styles[variant],
        size === 'sm' && styles.sizeSm,
        size === 'lg' && styles.sizeLg,
        block && styles.block,
        className,
      )}
      {...rest}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 13 : 15} /> : null}
      {children}
    </button>
  );
});

/* -------------------------------------------------------------------------- */

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** Required: these buttons have no visible text, so they need an accessible name. */
  label: string;
  size?: number;
  tone?: 'default' | 'danger';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 14, tone = 'default', className, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cx(
        styles.iconButton,
        tone === 'danger' && styles.iconButtonDanger,
        className,
      )}
      title={label}
      aria-label={label}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
});

/* -------------------------------------------------------------------------- */

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  leadingIcon?: IconName;
  trailing?: ReactNode;
  /** Drops the border and background, for the widget's inline add field. */
  seamless?: boolean;
  inputSize?: 'md' | 'lg';
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, hint, error, leadingIcon, trailing, seamless, inputSize = 'md', className, ...rest },
  ref,
) {
  return (
    <div className={cx(styles.field, className)}>
      {label ? (
        <label className={styles.label} htmlFor={rest.id}>
          {label}
        </label>
      ) : null}

      <div
        className={cx(
          styles.inputWrap,
          seamless && styles.inputWrapSeamless,
          inputSize === 'lg' && styles.inputLarge,
        )}
      >
        {leadingIcon ? (
          <span className={styles.adornment}>
            <Icon name={leadingIcon} size={15} />
          </span>
        ) : null}
        <input ref={ref} className={styles.input} {...rest} />
        {trailing ? <span className={styles.adornment}>{trailing}</span> : null}
      </div>

      {error ? (
        <span className={cx(styles.hint, styles.hintError)}>{error}</span>
      ) : hint ? (
        <span className={styles.hint}>{hint}</span>
      ) : null}
    </div>
  );
});

/* -------------------------------------------------------------------------- */

export interface CheckboxProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

/**
 * A button with `role="checkbox"` rather than a native input, because the tick
 * needs to be an icon that inherits the accent colour and native checkbox
 * styling is not reliably overridable across WebView2 and Chrome.
 */
export function Checkbox({ checked, onChange, label, className, ...rest }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className={cx(styles.checkbox, checked && styles.checkboxChecked, className)}
      onClick={() => onChange(!checked)}
      {...rest}
    >
      {checked ? <Icon name="check" size={13} /> : null}
    </button>
  );
}

/* -------------------------------------------------------------------------- */

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

export function Switch({ checked, onChange, label, className, ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx(styles.switch, checked && styles.switchOn, className)}
      onClick={() => onChange(!checked)}
      {...rest}
    >
      <span className={styles.switchThumb} />
    </button>
  );
}

/* -------------------------------------------------------------------------- */

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={styles.kbd}>{children}</kbd>;
}
