export type TaskStatus =
  | "queued"
  | "claimed"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type TaskLifecycleState =
  | "queued"
  | "claimed"
  | "running"
  | "retrying"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "stale";

export type TaskHostState = "idle" | "running" | "stopping" | "stopped";

export type TaskStepKind = "step" | "event" | "checkpoint" | "log" | (string & {});
export type TaskStepLevel = "debug" | "info" | "success" | "warn" | "error" | (string & {});

export type TaskProgressState = {
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

export type TaskTerminalError = {
  message: string;
  name?: string;
  code?: string;
  stack?: string;
  details?: unknown;
};

export type TaskRecord<TInput = unknown, TResult = unknown> = {
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

export type TaskStepRecord = {
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

export type TaskSnapshot<TInput = unknown, TResult = unknown> = {
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

export type TaskListQuery = {
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

export type TaskSnapshotQuery = TaskListQuery & {
  states?: TaskLifecycleState[] | null;
  includeSteps?: number | null;
};

export type TaskStepListQuery = {
  limit?: number;
  offset?: number;
};

export type TaskAggregateSnapshot = {
  total: number;
  byState: Record<TaskLifecycleState, number>;
  byStatus: Record<TaskStatus, number>;
  byKind: Record<string, number>;
  updatedAt: string;
};

export type TaskRetentionPolicy = {
  successTtlMs?: number;
  failedTtlMs?: number;
  cancelledTtlMs?: number;
  stepLimitPerTask?: number;
  keepLatestSuccessesPerKind?: number;
  keepLatestFailuresPerKind?: number;
};

export type TaskRetentionResult = {
  deletedTasks: number;
  deletedSteps: number;
  compactedTasks: number;
};
