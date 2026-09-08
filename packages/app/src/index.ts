export {
  RecallProvider,
  RecallContext,
  useRecall,
  useTasks,
  useSyncStatus,
  useTaskActions,
} from './context.js';
export type { RecallProviderProps, RecallContextValue, TaskLists } from './context.js';

/** Development harness: the real engine against an in-memory server, no backend required. */
export { DemoProvider } from './dev.js';
export type { DemoProviderProps } from './dev.js';

export {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
  watchPreferences,
} from './settings.js';
export type { Preferences } from './settings.js';

export { AuthGate, SignIn } from './components/AuthGate.js';
export { TaskListView, relativeTime } from './components/TaskListView.js';
export type { TaskListViewProps } from './components/TaskListView.js';
export { SettingsPanel, Section, Row } from './components/SettingsPanel.js';
export type { SettingsPanelProps } from './components/SettingsPanel.js';

export { FullView } from './views/FullView.js';
export type { FullViewProps } from './views/FullView.js';
export { WidgetView } from './views/WidgetView.js';
export type { WidgetViewProps } from './views/WidgetView.js';
export { QuickCaptureView } from './views/QuickCaptureView.js';
export type { QuickCaptureViewProps } from './views/QuickCaptureView.js';
export { PopupView } from './views/PopupView.js';
export type { PopupViewProps } from './views/PopupView.js';
