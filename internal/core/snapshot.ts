import type {
  TaskAggregateSnapshot,
  TaskLifecycleState,
  TaskListQuery,
  TaskRecord,
  TaskSnapshot,
  TaskSnapshotQuery,
  TaskStatus,
  TaskSubscriptionQuery,
} from "#2kjvrax0gr4m";
import { channelsIntersect, resolveTaskChannels } from "./channels.js";
import { nowIso } from "./utils.js";

const TASK_LIFECYCLE_STATES: TaskLifecycleState[] = [
  "queued",
  "claimed",
  "running",
  "retrying",
  "succeeded",
  "failed",
  "cancelled",
  "stale",
];

const TASK_STATUSES: TaskStatus[] = [
  "queued",
  "claimed",
  "running",
  "succeeded",
  "failed",
  "cancelled",
];

function resolveTaskLifecycleState(task: Pick<TaskRecord, "attempt" | "retryScheduledAt" | "staleAt" | "status">): TaskLifecycleState {
  if (task.staleAt && (task.status === "queued" || task.status === "claimed" || task.status === "running")) {
    return "stale";
  }

  if (task.status === "queued" && task.attempt > 0 && task.retryScheduledAt) {
    return "retrying";
  }

  return task.status;
}

function createTaskProgressState(task: TaskRecord): TaskSnapshot["progress"] {
  return {
    state: resolveTaskLifecycleState(task),
    percent: task.progressPercent,
    label: task.progressLabel,
    meta: task.progressMeta,
    startedAt: task.startedAt,
    updatedAt: task.updatedAt,
    finishedAt: task.finishedAt,
    retryScheduledAt: task.retryScheduledAt,
    staleAt: task.staleAt,
    staleReason: task.staleReason,
    lastHeartbeatAt: task.lastHeartbeatAt,
  };
}

function createTaskSnapshot<TInput = unknown, TResult = unknown>(task: TaskRecord<TInput, TResult>): TaskSnapshot<TInput, TResult> {
  return {
    taskId: task.id,
    kind: task.kind,
    status: task.status,
    state: resolveTaskLifecycleState(task),
    input: task.input,
    output: task.output,
    error: task.error,
    metadata: task.metadata,
    progress: createTaskProgressState(task),
    concurrencyKey: task.concurrencyKey,
    dedupeKey: task.dedupeKey,
    supersedeKey: task.supersedeKey,
    channels: resolveTaskChannels(task),
    attempt: task.attempt,
    maxAttempts: task.maxAttempts,
    scheduledAt: task.scheduledAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    claimedAt: task.claimedAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    cancelRequestedAt: task.cancelRequestedAt,
    leaseOwner: task.leaseOwner,
    leaseExpiresAt: task.leaseExpiresAt,
  };
}

function matchesTaskQuery(snapshot: TaskSnapshot, query?: TaskSnapshotQuery | TaskSubscriptionQuery | TaskListQuery | null): boolean {
  if (!query) {
    return true;
  }

  if ("taskIds" in query && query.taskIds?.length && !query.taskIds.includes(snapshot.taskId)) {
    return false;
  }

  if (query.kinds?.length && !query.kinds.includes(snapshot.kind)) {
    return false;
  }

  if (query.statuses?.length && !query.statuses.includes(snapshot.status)) {
    return false;
  }

  if ("states" in query && query.states?.length && !query.states.includes(snapshot.state)) {
    return false;
  }

  if (query.channels?.length && !channelsIntersect(snapshot.channels, query.channels)) {
    return false;
  }

  if ("concurrencyKey" in query && query.concurrencyKey && snapshot.concurrencyKey !== query.concurrencyKey) {
    return false;
  }

  if ("dedupeKey" in query && query.dedupeKey && snapshot.dedupeKey !== query.dedupeKey) {
    return false;
  }

  if ("supersedeKey" in query && query.supersedeKey && snapshot.supersedeKey !== query.supersedeKey) {
    return false;
  }

  return true;
}

function buildTaskAggregateSnapshot(snapshots: TaskSnapshot[]): TaskAggregateSnapshot {
  const byState = Object.fromEntries(TASK_LIFECYCLE_STATES.map((state) => [state, 0])) as Record<TaskLifecycleState, number>;
  const byStatus = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<TaskStatus, number>;
  const byKind: Record<string, number> = {};

  for (const snapshot of snapshots) {
    byState[snapshot.state] += 1;
    byStatus[snapshot.status] += 1;
    byKind[snapshot.kind] = (byKind[snapshot.kind] || 0) + 1;
  }

  return {
    total: snapshots.length,
    byState,
    byStatus,
    byKind,
    updatedAt: nowIso(),
  };
}

export {
  buildTaskAggregateSnapshot,
  createTaskProgressState,
  createTaskSnapshot,
  matchesTaskQuery,
  resolveTaskLifecycleState,
};
