import type {
  TaskAggregateSnapshot,
  TaskHostState,
  TaskLifecycleState,
  TaskListQuery,
  TaskRecord,
  TaskRetentionPolicy,
  TaskRetentionResult,
  TaskSnapshot,
  TaskSnapshotQuery,
  TaskStatus,
  TaskStepListQuery,
  TaskStepRecord,
} from "./core.js";
import type {
  TaskEnqueueOptions,
  TaskEnqueueResult,
  TaskExecutionHandle,
  TaskExecutor,
  TaskHandlerRegistration,
  TaskHostEventListener,
  TaskLifecycleEvent,
  TaskLifecycleEventListener,
} from "./execution.js";
import type { TaskStore } from "./store.js";
import type { TaskLogger, TaskLoggerAdapter } from "./logging.js";

export type TaskRunnerOptions = {
  id?: string;
  pollIntervalMs?: number;
  heartbeatMs?: number;
  leaseMs?: number;
  globalConcurrency?: number;
  staleScanIntervalMs?: number;
  staleScanLimit?: number;
  watchdogMs?: number;
  watchdogScanIntervalMs?: number;
  retentionPolicy?: TaskRetentionPolicy;
  retentionScanIntervalMs?: number;
  stopTimeoutMs?: number;
};

export type TaskHostOptions = {
  store: TaskStore;
  executor?: TaskExecutor;
  handlers?: TaskHandlerRegistration[];
  runner?: TaskRunnerOptions;
  logger?: TaskLogger;
  loggerAdapter?: TaskLoggerAdapter;
  onEvent?: TaskHostEventListener;
  onLifecycleEvent?: TaskLifecycleEventListener;
  defaultMaxAttempts?: number;
};

export type TaskSubscriptionQuery = {
  taskIds?: string[] | null;
  channels?: string[] | null;
  kinds?: string[] | null;
  states?: TaskLifecycleState[] | null;
  statuses?: TaskStatus[] | null;
  concurrencyKey?: string | null;
  dedupeKey?: string | null;
  supersedeKey?: string | null;
  limit?: number;
  recentSteps?: number | null;
  includeAggregate?: boolean;
};

export type TaskSubscriptionBootstrap = {
  type: "bootstrap";
  timestamp: string;
  query: TaskSubscriptionQuery;
  snapshots: TaskSnapshot[];
  steps: Record<string, TaskStepRecord[]>;
  aggregate: TaskAggregateSnapshot | null;
};

export type TaskLiveUpdate = {
  type: "event";
  timestamp: string;
  event: TaskLifecycleEvent;
};

export type TaskLiveMessage = TaskSubscriptionBootstrap | TaskLiveUpdate;

export type TaskLiveHub = {
  bootstrap: (query?: TaskSubscriptionQuery) => Promise<TaskSubscriptionBootstrap>;
  subscribe: (query: TaskSubscriptionQuery | undefined, listener: (message: TaskLiveMessage) => void | Promise<void>) => Promise<() => void>;
};

export type TaskHost = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getState: () => TaskHostState;
  registerHandler: (handler: TaskHandlerRegistration) => TaskHost;
  enqueue: <TInput = unknown>(kind: string, input: TInput, options?: TaskEnqueueOptions) => Promise<TaskEnqueueResult>;
  getTask: <TInput = unknown, TResult = unknown>(taskId: string) => Promise<TaskRecord<TInput, TResult> | null>;
  listTasks: <TInput = unknown, TResult = unknown>(query?: TaskListQuery) => Promise<TaskRecord<TInput, TResult>[]>;
  listTaskSteps: (taskId: string, query?: TaskStepListQuery) => Promise<TaskStepRecord[]>;
  readSnapshot: <TInput = unknown, TResult = unknown>(taskId: string, options?: {
    includeSteps?: number | null;
  }) => Promise<(TaskSnapshot<TInput, TResult> & {
    steps?: TaskStepRecord[];
  }) | null>;
  listSnapshots: <TInput = unknown, TResult = unknown>(query?: TaskSnapshotQuery) => Promise<Array<TaskSnapshot<TInput, TResult> & {
    steps?: TaskStepRecord[];
  }>>;
  readAggregate: (query?: TaskListQuery) => Promise<TaskAggregateSnapshot>;
  bootstrap: (query?: TaskSubscriptionQuery) => Promise<TaskSubscriptionBootstrap>;
  compact: (policy?: TaskRetentionPolicy | null) => Promise<TaskRetentionResult>;
  cancel: (taskId: string, reason?: string) => Promise<TaskRecord | null>;
  onEvent: (listener: TaskHostEventListener) => () => void;
  onLifecycleEvent: (listener: TaskLifecycleEventListener) => () => void;
};

export type TaskLiveTrackerState = {
  snapshots: TaskSnapshot[];
  steps: Record<string, TaskStepRecord[]>;
  aggregate: TaskAggregateSnapshot | null;
  updatedAt: string | null;
};

export type TaskLiveTracker = {
  apply: (message: TaskLiveMessage) => TaskLiveTrackerState;
  getState: () => TaskLiveTrackerState;
  onChange: (listener: (state: TaskLiveTrackerState) => void) => () => void;
};

export type TaskLiveSocketLike = {
  emit: (event: string, payload: unknown) => unknown;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
};

export type TaskLiveSocketServerLike = {
  on: (event: "connection", listener: (socket: TaskLiveSocketLike) => void) => unknown;
};

export type TaskLiveSocketBridgeOptions = {
  hub: TaskLiveHub;
  subscribeEvent?: string;
  unsubscribeEvent?: string;
  publishEvent?: string;
};
