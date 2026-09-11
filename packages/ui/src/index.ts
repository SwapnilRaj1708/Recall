import './tokens.css';

export { Icon } from './components/Icon.js';
export type { IconName, IconProps } from './components/Icon.js';

export {
  cx,
  Surface,
  Button,
  IconButton,
  TextInput,
  Checkbox,
  Switch,
  Kbd,
} from './components/primitives.js';
export type {
  SurfaceProps,
  ButtonProps,
  IconButtonProps,
  TextInputProps,
  CheckboxProps,
  SwitchProps,
} from './components/primitives.js';

export { TaskRow } from './components/TaskRow.js';
export type { TaskRowProps } from './components/TaskRow.js';
export { QuickAdd } from './components/QuickAdd.js';
export type { QuickAddProps, QuickAddHandle } from './components/QuickAdd.js';

export {
  Modal,
  Menu,
  ToastProvider,
  useToast,
  EmptyState,
  ErrorState,
  SkeletonList,
  SyncBadge,
} from './components/feedback.js';
export type {
  ModalProps,
  MenuProps,
  MenuItem,
  Toast,
  StateProps,
  ErrorStateProps,
  SyncBadgeProps,
} from './components/feedback.js';

export {
  applyTheme,
  normalizeTheme,
  prefersDark,
  watchSystemTheme,
  shade,
  readableOn,
  DEFAULT_THEME,
  widgetTheme,
  opaqueTheme,
  WIDGET_ALPHA_FACTOR,
  WIDGET_ROW_HEIGHT_DELTA,
  THEME_LIMITS,
  ACCENT_PRESETS,
} from './theme.js';
export type { ThemeMode, ThemeSettings } from './theme.js';

/** Shared class names defined in tokens.css. */
export const listStyles = {
  scroll: 'rc-scroll',
  glass: 'rc-glass',
  srOnly: 'rc-sr-only',
} as const;
