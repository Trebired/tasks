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

type TaskHostState = "idle" | "running" | "stopping" | "stopped";

type TaskStepKind = "step" | "event";

type TaskProgressSnapshot = {
  percent: number | null;
  label: string | null;
  meta: Record<string, unknown> | null;
  updatedAt: string | null;
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
};

type TaskStepRecord = {
  sequence: string;
  taskId: string;
  attempt: number;
  kind: TaskStepKind;
  label: string;
  meta: Record<string, unknown> | null;
  progressPercent: number | null;
  createdAt: string;
};

type TaskListQuery = {
  kinds?: string[] | null;
  statuses?: TaskStatus[] | null;
  concurrencyKey?: string | null;
  dedupeKey?: string | null;
  limit?: number;
  offset?: number;
  orderBy?: "created_asc" | "created_desc" | "scheduled_asc" | "scheduled_desc";
};

type TaskStepListQuery = {
  limit?: number;
  offset?: number;
};

type TaskCreateInput<TInput = unknown> = {
  id: string;
  kind: string;
  input: TInput;
  metadata?: Record<string, unknown> | null;
  concurrencyKey?: string | null;
  dedupeKey?: string | null;
  maxAttempts: number;
  scheduledAt: string;
};

type TaskCreateResult = {
  task: TaskRecord;
  deduplicated: boolean;
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
  label: string;
  meta?: Record<string, unknown> | null;
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

type TaskStaleRequeueInput = {
  limit?: number;
  now?: string;
};

type TaskStore = {
  createTask: <TInput = unknown>(input: TaskCreateInput<TInput>) => Promise<TaskCreateResult>;
  getTask: <TInput = unknown, TResult = unknown>(taskId: string) => Promise<TaskRecord<TInput, TResult> | null>;
  listTasks: <TInput = unknown, TResult = unknown>(query?: TaskListQuery) => Promise<TaskRecord<TInput, TResult>[]>;
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
  requeueStaleTasks: (input?: TaskStaleRequeueInput) => Promise<number>;
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

type TaskRetryResolver = (context: TaskRetryContext) => TaskRetryDecision | string | Date | number | null | Promise<TaskRetryDecision | string | Date | number | null>;

type TaskRetryPolicy = {
  maxAttempts?: number;
  backoff?: TaskRetryBackoff | TaskRetryResolver;
};

type TaskHandlerModuleContext = {
  task: Pick<TaskRecord, "attempt" | "id" | "kind" | "maxAttempts" | "metadata">;
  signal: AbortSignal;
  setProgress: (input: {
    percent?: number | null;
    label?: string | null;
    meta?: Record<string, unknown> | null;
  }) => Promise<void>;
  appendStep: (input: {
    kind?: TaskStepKind;
    label: string;
    meta?: Record<string, unknown> | null;
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
  maxAttempts?: number;
  scheduledAt?: string | Date | number | null;
};

type TaskEnqueueResult = {
  task: TaskRecord;
  deduplicated: boolean;
};

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
      label: string;
      meta?: Record<string, unknown> | null;
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
      | "task:lease_lost";
    timestamp: string;
    runnerId: string;
    taskId: string;
    kind: string;
    task?: TaskRecord | null;
    deduplicated?: boolean;
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

type TaskRunnerOptions = {
  id?: string;
  pollIntervalMs?: number;
  heartbeatMs?: number;
  leaseMs?: number;
  globalConcurrency?: number;
  staleScanIntervalMs?: number;
  staleScanLimit?: number;
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
  defaultMaxAttempts?: number;
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
  cancel: (taskId: string, reason?: string) => Promise<TaskRecord | null>;
  onEvent: (listener: TaskHostEventListener) => () => void;
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
  TaskAppendStepInput,
  TaskCancelInput,
  TaskCancelRunningInput,
  TaskClaimNextOptions,
  TaskCreateInput,
  TaskCreateResult,
  TaskDedupeLookup,
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
  TaskListQuery,
  TaskLogEvent,
  TaskLogger,
  TaskLoggerAdapter,
  TaskLogMethod,
  TaskProgressSnapshot,
  TaskRecord,
  TaskRetryBackoff,
  TaskRetryContext,
  TaskRetryDecision,
  TaskRetryInput,
  TaskRetryPolicy,
  TaskRetryResolver,
  TaskRunnerOptions,
  TaskStatus,
  TaskStepKind,
  TaskStepListQuery,
  TaskStepRecord,
  TaskStaleRequeueInput,
  TaskStore,
  TaskSuccessInput,
  TaskTerminalError,
  TaskUpdateProgressInput,
};
