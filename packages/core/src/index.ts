// Model
export type { Task, TaskField, SyncStatus, AuthState } from './model/types.js';
export { TASK_FIELDS, FIELD_CLOCK, MAX_TEXT_LENGTH } from './model/types.js';
export { Clock, clock, isNewer, maxTimestamp } from './model/clock.js';
export {
  positionBefore,
  positionAfter,
  positionBetween,
  positionsBetween,
  positionForNewCapture,
  compareByPosition,
  isValidPosition,
} from './model/fracIndex.js';
export { mergeTask, mergeAll, isSameVersion, withDerivedUpdatedAt } from './model/merge.js';
export {
  newId,
  normalizeText,
  isBlank,
  createTask,
  withText,
  withCompleted,
  withPosition,
  withDeleted,
  isDeleted,
  isActive,
  isOpen,
  isPurgeableTombstone,
  TOMBSTONE_RETENTION_MS,
} from './model/task.js';

// Storage
export type { StorageAdapter } from './storage/types.js';
export { META_CURSOR, META_LAST_SYNCED, META_DEVICE_ID } from './storage/types.js';
export { MemoryStorage } from './storage/memory.js';
export { IndexedDbStorage, indexedDbAvailable } from './storage/indexeddb.js';
export { ChromeStorage, chromeStorageAvailable } from './storage/chromeStorage.js';

// Sync
export { SyncEngine } from './sync/engine.js';
export type { SyncEngineOptions, Timers } from './sync/engine.js';
export { Outbox } from './sync/outbox.js';
export { backoffDelay } from './sync/backoff.js';
export type {
  RemoteAdapter,
  OutboxEntry,
  PullResult,
  RealtimeState,
} from './sync/types.js';
export { PermanentSyncError, TransientSyncError, AuthSyncError } from './sync/types.js';

// Supabase
export { createRecallClient, isConfigured } from './supabase/client.js';
export type { RecallConfig, ClientOptions, SessionStorage } from './supabase/client.js';
export { SupabaseRemote, classify } from './supabase/remote.js';
export { AuthController } from './supabase/auth.js';
export type { OAuthLauncher } from './supabase/auth.js';
export { fromRow, toRow } from './supabase/rows.js';
export type { TaskRow } from './supabase/rows.js';
