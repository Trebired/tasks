import type { URL } from "node:url";
import type {
  LoggerAdapterEvent,
  LoggerAdapterGenericLogMethod,
  LoggerAdapterLogger,
  LoggerAdapterLogMethod,
  LoggerAdapterWriter,
  NormalizedLoggerAdapter,
} from "@trebired/logger-adapter";

type TaskStatus =
  | "queued"
  | "claimed"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

type TaskLifecycleState =
  | "queued"
  | "claimed"
  | "running"
  | "retrying"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "stale";

type TaskHostState = "idle" | "running" | "stopping" | "stopped";

type TaskStepKind = "step" | "event" | "checkpoint" | "log" | (string & {});
type TaskStepLevel = "debug" | "info" | "success" | "warn" | "error" | (string & {});

type TaskProgressState = {
  state: TaskLifecycleState;
  percent: number | null;
  label: string | null;
  meta: Record<string, unknown> | null;
  startedAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
  retryScheduledAt: string | null;
  staleAt: string | null;
  staleReason: string | null;
  lastHeartbeatAt: string | null;
};

type TaskTerminalError = {
  message: string;
  name?: string;
  code?: string;
  stack?: string;
  details?: unknown;
};

type TaskRecord<TInput = unknown, TResult = unknown> = {
  id: string;
  kind: string;
  status: TaskStatus;
  input: TInput;
  output: TResult | null;
  error: TaskTerminalError | null;
  metadata: Record<string, unknown> | null;
  progressPercent: number | null;
  progressLabel: string | null;
  progressMeta: Record<string, unknown> | null;
  concurrencyKey: string | null;
  dedupeKey: string | null;
  supersedeKey: string | null;
  channels: string[];
  attempt: number;
  maxAttempts: number;
  scheduledAt: string;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  cancelRequestedAt: string | null;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  lastHeartbeatAt: string | null;
  retryScheduledAt: string | null;
  staleAt: string | null;
  staleReason: string | null;
};

type TaskStepRecord = {
  id: string;
  taskId: string;
  attempt: number;
  kind: TaskStepKind;
  level: TaskStepLevel;
  message: string;
  meta: Record<string, unknown> | null;
  percent: number | null;
  createdAt: string;
};

type TaskSnapshot<TInput = unknown, TResult = unknown> = {
  taskId: string;
  kind: string;
  status: TaskStatus;
  state: TaskLifecycleState;
  input: TInput;
  output: TResult | null;
  error: TaskTerminalError | null;
  metadata: Record<string, unknown> | null;
  progress: TaskProgressState;
  concurrencyKey: string | null;
  dedupeKey: string | null;
  supersedeKey: string | null;
  channels: string[];
  attempt: number;
  maxAttempts: number;
  scheduledAt: string;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  cancelRequestedAt: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
};

type TaskListQuery = {
  taskIds?: string[] | null;
  kinds?: string[] | null;
  statuses?: TaskStatus[] | null;
  channels?: string[] | null;
  concurrencyKey?: string | null;
  dedupeKey?: string | null;
  supersedeKey?: string | null;
  limit?: number;
  offset?: number;
  orderBy?: "created_asc" | "created_desc" | "scheduled_asc" | "scheduled_desc" | "updated_desc";
};

type TaskSnapshotQuery = TaskListQuery & {
  states?: TaskLifecycleState[] | null;
  includeSteps?: number | null;
};

type TaskStepListQuery = {
  limit?: number;
  offset?: number;
};

type TaskAggregateSnapshot = {
  total: number;
  byState: Record<TaskLifecycleState, number>;
  byStatus: Record<TaskStatus, number>;
  byKind: Record<string, number>;
  updatedAt: string;
};

type TaskCreateInput<TInput = unknown> = {
  id: string;
  kind: string;
  input: TInput;
  metadata?: Record<string, unknown> | null;
  concurrencyKey?: string | null;
  dedupeKey?: string | null;
  supersedeKey?: string | null;
  supersedeExisting?: boolean;
  channels?: string[] | null;
  maxAttempts: number;
  scheduledAt: string;
};

type TaskEnqueueDisposition = "created" | "reused" | "superseded";

type TaskCreateResult = {
  task: TaskRecord;
  deduplicated: boolean;
  disposition: TaskEnqueueDisposition;
  reusedTaskId: string | null;
  supersededTaskIds: string[];
};

type TaskDedupeLookup = {
  kind: string;
  dedupeKey: string;
  openOnly?: boolean;
};

type TaskClaimNextOptions = {
  runnerId: string;
  leaseMs: number;
  kinds: string[];
  globalConcurrency?: number | null;
  perKindConcurrency?: Record<string, number | undefined>;
  now?: string;
  candidateLimit?: number;
};

type TaskLeaseInput = {
  taskId: string;
  runnerId: string;
  leaseToken: string;
};

type TaskLeaseRenewalInput = TaskLeaseInput & {
  leaseMs: number;
  now?: string;
};

type TaskAppendStepInput = TaskLeaseInput & {
  attempt: number;
  kind?: TaskStepKind;
  level?: TaskStepLevel;
  message?: string;
  label?: string;
  meta?: Record<string, unknown> | null;
  percent?: number | null;
  progressPercent?: number | null;
  createdAt?: string;
};

type TaskUpdateProgressInput = TaskLeaseInput & {
  percent?: number | null;
  label?: string | null;
  meta?: Record<string, unknown> | null;
  updatedAt?: string;
};

type TaskSuccessInput<TResult = unknown> = TaskLeaseInput & {
  output: TResult;
  finishedAt?: string;
};

type TaskFailureInput = TaskLeaseInput & {
  error: TaskTerminalError;
  finishedAt?: string;
};

type TaskCancelInput = {
  taskId: string;
  reason?: string;
  requestedAt?: string;
};

type TaskCancelRunningInput = TaskLeaseInput & {
  reason?: string;
  finishedAt?: string;
};

type TaskRetryInput = TaskLeaseInput & {
  error: TaskTerminalError;
  scheduledAt: string;
};

type TaskMarkStaleInput = {
  staleAfterMs: number;
  limit?: number;
  now?: string;
  reason?: string;
};

type TaskStaleRequeueInput = {
  limit?: number;
  now?: string;
};

type TaskRetentionPolicy = {
  successTtlMs?: number;
  failedTtlMs?: number;
  cancelledTtlMs?: number;
  stepLimitPerTask?: number;
  keepLatestSuccessesPerKind?: number;
  keepLatestFailuresPerKind?: number;
};

type TaskRetentionResult = {
  deletedTasks: number;
  deletedSteps: number;
  compactedTasks: number;
};

type TaskStore = {
  createTask: <TInput = unknown>(input: TaskCreateInput<TInput>) => Promise<TaskCreateResult>;
  getTask: <TInput = unknown, TResult = unknown>(taskId: string) => Promise<TaskRecord<TInput, TResult> | null>;
  listTasks: <TInput = unknown, TResult = unknown>(query?: TaskListQuery) => Promise<TaskRecord<TInput, TResult>[]>;
  summarizeTasks: (query?: TaskListQuery) => Promise<TaskAggregateSnapshot>;
  listTaskSteps: (taskId: string, query?: TaskStepListQuery) => Promise<TaskStepRecord[]>;
  findTaskByDedupeKey: <TInput = unknown, TResult = unknown>(input: TaskDedupeLookup) => Promise<TaskRecord<TInput, TResult> | null>;
  claimNextTask: <TInput = unknown, TResult = unknown>(input: TaskClaimNextOptions) => Promise<TaskRecord<TInput, TResult> | null>;
  markTaskRunning: <TInput = unknown, TResult = unknown>(input: TaskLeaseInput) => Promise<TaskRecord<TInput, TResult> | null>;
  renewTaskLease: <TInput = unknown, TResult = unknown>(input: TaskLeaseRenewalInput) => Promise<TaskRecord<TInput, TResult> | null>;
  appendTaskStep: (input: TaskAppendStepInput) => Promise<TaskStepRecord | null>;
  updateTaskProgress: <TInput = unknown, TResult = unknown>(input: TaskUpdateProgressInput) => Promise<TaskRecord<TInput, TResult> | null>;
  markTaskSucceeded: <TInput = unknown, TResult = unknown>(input: TaskSuccessInput<TResult>) => Promise<TaskRecord<TInput, TResult> | null>;
  markTaskFailed: <TInput = unknown, TResult = unknown>(input: TaskFailureInput) => Promise<TaskRecord<TInput, TResult> | null>;
  cancelTask: <TInput = unknown, TResult = unknown>(input: TaskCancelInput) => Promise<TaskRecord<TInput, TResult> | null>;
  markTaskCancelled: <TInput = unknown, TResult = unknown>(input: TaskCancelRunningInput) => Promise<TaskRecord<TInput, TResult> | null>;
  requeueTask: <TInput = unknown, TResult = unknown>(input: TaskRetryInput) => Promise<TaskRecord<TInput, TResult> | null>;
  markStaleTasks: <TInput = unknown, TResult = unknown>(input: TaskMarkStaleInput) => Promise<TaskRecord<TInput, TResult>[]>;
  requeueStaleTasks: (input?: TaskStaleRequeueInput) => Promise<number>;
  applyRetentionPolicy: (policy: TaskRetentionPolicy) => Promise<TaskRetentionResult>;
};

type TaskRetryDecision = {
  retry: boolean;
  scheduledAt?: string | Date | number | null;
};

type TaskRetryBackoff = {
  minDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: number;
};

type TaskRetryContext = {
  task: TaskRecord;
  handler: TaskHandlerRegistration;
  error: TaskTerminalError;
  attempt: number;
  maxAttempts: number;
};

type TaskRetryResolver = (
  context: TaskRetryContext,
) => TaskRetryDecision | string | Date | number | null | Promise<TaskRetryDecision | string | Date | number | null>;

type TaskRetryPolicy = {
  maxAttempts?: number;
  backoff?: TaskRetryBackoff | TaskRetryResolver;
};

type TaskHandlerModuleContext = {
  task: Pick<TaskRecord, "attempt" | "channels" | "dedupeKey" | "id" | "kind" | "maxAttempts" | "metadata" | "supersedeKey">;
  signal: AbortSignal;
  setProgress: (input: {
    percent?: number | null;
    label?: string | null;
    meta?: Record<string, unknown> | null;
  }) => Promise<void>;
  appendStep: (input: {
    kind?: TaskStepKind;
    level?: TaskStepLevel;
    message?: string;
    label?: string;
    meta?: Record<string, unknown> | null;
    percent?: number | null;
    progressPercent?: number | null;
  }) => Promise<void>;
};

type TaskHandlerModule<TInput = unknown, TResult = unknown> = {
  run: (input: TInput, context: TaskHandlerModuleContext) => TResult | Promise<TResult>;
};

type TaskHandlerEntrypoint = {
  module: string | URL;
  export?: string;
  runtime?: "inherit" | "node" | "bun";
  cwd?: string;
  env?: Record<string, string | undefined>;
  args?: string[];
};

type TaskHandlerRegistration<TInput = unknown, TResult = unknown> = {
  kind: string;
  entrypoint: TaskHandlerEntrypoint;
  concurrency?: {
    limit?: number;
  };
  retry?: TaskRetryPolicy;
  metadata?: Record<string, unknown> | null;
};

type TaskEnqueueOptions = {
  id?: string;
  metadata?: Record<string, unknown> | null;
  concurrencyKey?: string | null;
  dedupeKey?: string | null;
  supersedeKey?: string | null;
  supersedeExisting?: boolean;
  channels?: string[] | null;
  maxAttempts?: number;
  scheduledAt?: string | Date | number | null;
};

type TaskEnqueueResult = TaskCreateResult;

type TaskExecutorProgressEvent =
  | {
    type: "progress";
    progress: {
      percent?: number | null;
      label?: string | null;
      meta?: Record<string, unknown> | null;
    };
  }
  | {
    type: "step";
    step: {
      kind?: TaskStepKind;
      level?: TaskStepLevel;
      message?: string;
      label?: string;
      meta?: Record<string, unknown> | null;
      percent?: number | null;
      progressPercent?: number | null;
    };
  };

type TaskExecutorOutcome =
  | {
    status: "succeeded";
    output: unknown;
  }
  | {
    status: "failed";
    error: TaskTerminalError;
  }
  | {
    status: "cancelled";
    error?: TaskTerminalError | null;
  };

type TaskExecutorRunRequest = {
  task: TaskRecord;
  handler: TaskHandlerRegistration;
  signal: AbortSignal;
  onEvent?: (event: TaskExecutorProgressEvent) => void | Promise<void>;
};

type TaskExecutionHandle = {
  cancel: (reason?: string) => Promise<void>;
  completion: Promise<TaskExecutorOutcome>;
};

type TaskExecutor = {
  execute: (request: TaskExecutorRunRequest) => Promise<TaskExecutionHandle> | TaskExecutionHandle;
};

type TaskHostEvent =
  | {
    type: "runner:start" | "runner:stop";
    timestamp: string;
    runnerId: string;
  }
  | {
    type:
      | "task:enqueued"
      | "task:claimed"
      | "task:running"
      | "task:progress"
      | "task:step"
      | "task:succeeded"
      | "task:retry"
      | "task:failed"
      | "task:cancelled"
      | "task:stale"
      | "task:lease_lost";
    timestamp: string;
    runnerId: string;
    taskId: string;
    kind: string;
    task?: TaskRecord | null;
    deduplicated?: boolean;
    disposition?: TaskEnqueueDisposition;
    supersededTaskIds?: string[];
    step?: TaskStepRecord | null;
    error?: TaskTerminalError | unknown;
    output?: unknown;
  }
  | {
    type: "task:stale_requeued";
    timestamp: string;
    runnerId: string;
    count: number;
  };

type TaskHostEventListener = (event: TaskHostEvent) => void;

type TaskLifecycleEventName =
  | "enqueued"
  | "claimed"
  | "started"
  | "progress"
  | "step"
  | "retried"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "stale"
  | "lease_lost";

type TaskLifecycleEvent = {
  type: "task.lifecycle";
  event: TaskLifecycleEventName;
  timestamp: string;
  runnerId: string;
  taskId: string;
  kind: string;
  snapshot: TaskSnapshot | null;
  step: TaskStepRecord | null;
  channels: string[];
  disposition?: TaskEnqueueDisposition;
  supersededTaskIds?: string[];
  error?: TaskTerminalError | unknown;
  output?: unknown;
};

type TaskLifecycleEventListener = (event: TaskLifecycleEvent) => void;

type TaskRunnerOptions = {
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

type TaskHostOptions = {
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

type TaskSubscriptionQuery = {
  taskIds?: string[] | null;
  channels?: string[] | null;
  kinds?: string[] | null;
  states?: TaskLifecycleState[] | null;
  statuses?: TaskStatus[] | null;
  limit?: number;
  recentSteps?: number | null;
  includeAggregate?: boolean;
};

type TaskSubscriptionBootstrap = {
  type: "bootstrap";
  timestamp: string;
  query: TaskSubscriptionQuery;
  snapshots: TaskSnapshot[];
  steps: Record<string, TaskStepRecord[]>;
  aggregate: TaskAggregateSnapshot | null;
};

type TaskLiveUpdate = {
  type: "event";
  timestamp: string;
  event: TaskLifecycleEvent;
};

type TaskLiveMessage = TaskSubscriptionBootstrap | TaskLiveUpdate;

type TaskLiveHub = {
  bootstrap: (query?: TaskSubscriptionQuery) => Promise<TaskSubscriptionBootstrap>;
  subscribe: (query: TaskSubscriptionQuery | undefined, listener: (message: TaskLiveMessage) => void | Promise<void>) => Promise<() => void>;
};

type TaskHost = {
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

type TaskLiveTrackerState = {
  snapshots: TaskSnapshot[];
  steps: Record<string, TaskStepRecord[]>;
  aggregate: TaskAggregateSnapshot | null;
  updatedAt: string | null;
};

type TaskLiveTracker = {
  apply: (message: TaskLiveMessage) => TaskLiveTrackerState;
  getState: () => TaskLiveTrackerState;
  onChange: (listener: (state: TaskLiveTrackerState) => void) => () => void;
};

type TaskLiveSocketLike = {
  emit: (event: string, payload: unknown) => unknown;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
};

type TaskLiveSocketServerLike = {
  on: (event: "connection", listener: (socket: TaskLiveSocketLike) => void) => unknown;
};

type TaskLiveSocketBridgeOptions = {
  hub: TaskLiveHub;
  subscribeEvent?: string;
  unsubscribeEvent?: string;
  publishEvent?: string;
};

type TaskLogMethod = LoggerAdapterLogMethod;
type TaskLogEvent = LoggerAdapterEvent;
type TaskGenericLogMethod = LoggerAdapterGenericLogMethod;
type TaskLogger = LoggerAdapterLogger;
type TaskLoggerAdapter = LoggerAdapterWriter;
type NormalizedTaskLogger = NormalizedLoggerAdapter;

type PostgresTaskQueryResult<T = Record<string, unknown>> = {
  rows: T[];
  rowCount?: number | null;
};

type PostgresTaskQueryable = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<PostgresTaskQueryResult<T>>;
};

type PostgresTaskPoolClient = PostgresTaskQueryable & {
  release: () => void;
};

type PostgresTaskPool = PostgresTaskQueryable & {
  connect: () => Promise<PostgresTaskPoolClient>;
};

type PostgresTaskStoreOptions = {
  client: PostgresTaskPool;
  schema?: string;
  tablePrefix?: string;
};

type PostgresTaskSchemaOptions = {
  schema?: string;
  tablePrefix?: string;
};

type ChildProcessTaskExecutorOptions = {
  command?: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  killTimeoutMs?: number;
};

export type {
  ChildProcessTaskExecutorOptions,
  NormalizedTaskLogger,
  PostgresTaskPool,
  PostgresTaskPoolClient,
  PostgresTaskQueryResult,
  PostgresTaskQueryable,
  PostgresTaskSchemaOptions,
  PostgresTaskStoreOptions,
  TaskAggregateSnapshot,
  TaskAppendStepInput,
  TaskCancelInput,
  TaskCancelRunningInput,
  TaskClaimNextOptions,
  TaskCreateInput,
  TaskCreateResult,
  TaskDedupeLookup,
  TaskEnqueueDisposition,
  TaskEnqueueOptions,
  TaskEnqueueResult,
  TaskExecutionHandle,
  TaskExecutor,
  TaskExecutorOutcome,
  TaskExecutorProgressEvent,
  TaskExecutorRunRequest,
  TaskFailureInput,
  TaskGenericLogMethod,
  TaskHandlerEntrypoint,
  TaskHandlerModule,
  TaskHandlerModuleContext,
  TaskHandlerRegistration,
  TaskHost,
  TaskHostEvent,
  TaskHostEventListener,
  TaskHostOptions,
  TaskHostState,
  TaskLeaseInput,
  TaskLeaseRenewalInput,
  TaskLifecycleEvent,
  TaskLifecycleEventListener,
  TaskLifecycleEventName,
  TaskLifecycleState,
  TaskListQuery,
  TaskLiveHub,
  TaskLiveMessage,
  TaskLiveSocketBridgeOptions,
  TaskLiveSocketLike,
  TaskLiveSocketServerLike,
  TaskLiveTracker,
  TaskLiveTrackerState,
  TaskLiveUpdate,
  TaskLogEvent,
  TaskLogger,
  TaskLoggerAdapter,
  TaskLogMethod,
  TaskMarkStaleInput,
  TaskProgressState,
  TaskRecord,
  TaskRetentionPolicy,
  TaskRetentionResult,
  TaskRetryBackoff,
  TaskRetryContext,
  TaskRetryDecision,
  TaskRetryInput,
  TaskRetryPolicy,
  TaskRetryResolver,
  TaskRunnerOptions,
  TaskSnapshot,
  TaskSnapshotQuery,
  TaskStatus,
  TaskStepKind,
  TaskStepLevel,
  TaskStepListQuery,
  TaskStepRecord,
  TaskStaleRequeueInput,
  TaskStore,
  TaskSubscriptionBootstrap,
  TaskSubscriptionQuery,
  TaskSuccessInput,
  TaskTerminalError,
  TaskUpdateProgressInput,
};
