import type {
  TaskAggregateSnapshot,
  TaskListQuery,
  TaskRecord,
  TaskRetentionPolicy,
  TaskRetentionResult,
  TaskStatus,
  TaskStepKind,
  TaskStepLevel,
  TaskStepListQuery,
  TaskStepRecord,
  TaskTerminalError,
} from "./core.js";

export type TaskCreateInput<TInput = unknown> = {
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

export type TaskEnqueueDisposition = "created" | "reused" | "superseded";

export type TaskCreateResult = {
  task: TaskRecord;
  deduplicated: boolean;
  disposition: TaskEnqueueDisposition;
  reusedTaskId: string | null;
  supersededTaskIds: string[];
};

export type TaskDedupeLookup = {
  kind: string;
  dedupeKey: string;
  openOnly?: boolean;
};

export type TaskClaimNextOptions = {
  runnerId: string;
  leaseMs: number;
  kinds: string[];
  globalConcurrency?: number | null;
  perKindConcurrency?: Record<string, number | undefined>;
  now?: string;
  candidateLimit?: number;
};

export type TaskLeaseInput = {
  taskId: string;
  runnerId: string;
  leaseToken: string;
};

export type TaskLeaseRenewalInput = TaskLeaseInput & {
  leaseMs: number;
  now?: string;
};

export type TaskAppendStepInput = TaskLeaseInput & {
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

export type TaskUpdateProgressInput = TaskLeaseInput & {
  percent?: number | null;
  label?: string | null;
  meta?: Record<string, unknown> | null;
  updatedAt?: string;
};

export type TaskSuccessInput<TResult = unknown> = TaskLeaseInput & {
  output: TResult;
  finishedAt?: string;
};

export type TaskFailureInput = TaskLeaseInput & {
  error: TaskTerminalError;
  finishedAt?: string;
};

export type TaskCancelInput = {
  taskId: string;
  reason?: string;
  requestedAt?: string;
};

export type TaskCancelRunningInput = TaskLeaseInput & {
  reason?: string;
  finishedAt?: string;
};

export type TaskRetryInput = TaskLeaseInput & {
  error: TaskTerminalError;
  scheduledAt: string;
};

export type TaskMarkStaleInput = {
  staleAfterMs: number;
  limit?: number;
  now?: string;
  reason?: string;
};

export type TaskStaleRequeueInput = {
  limit?: number;
  now?: string;
};

export type TaskStore = {
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
