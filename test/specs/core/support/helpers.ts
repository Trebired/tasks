import type {
  TaskAppendStepInput,
  TaskCreateInput,
  TaskCreateResult,
  TaskListQuery,
  TaskRecord,
  TaskStepRecord,
} from "#2kjvrax0gr4m";

const ACTIVE_TASK_STATUSES = new Set(["queued", "claimed", "running"]);

export function createTaskRecord<TInput>(input: TaskCreateInput<TInput>, createdAt: string): TaskRecord {
  return {
    id: input.id,
    kind: input.kind,
    status: "queued",
    input: input.input,
    output: null,
    error: null,
    metadata: input.metadata ?? null,
    progressPercent: null,
    progressLabel: null,
    progressMeta: null,
    concurrencyKey: input.concurrencyKey ?? null,
    dedupeKey: input.dedupeKey ?? null,
    supersedeKey: input.supersedeKey ?? null,
    channels: input.channels ?? [],
    attempt: 0,
    maxAttempts: input.maxAttempts,
    scheduledAt: input.scheduledAt,
    createdAt,
    updatedAt: createdAt,
    claimedAt: null,
    startedAt: null,
    finishedAt: null,
    cancelRequestedAt: null,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    retryScheduledAt: null,
    staleAt: null,
    staleReason: null,
  };
}

export function createCreatedTaskResult(task: TaskRecord, supersededTaskIds: string[]): TaskCreateResult {
  return {
    task,
    deduplicated: false,
    disposition: supersededTaskIds.length ? "superseded" : "created",
    reusedTaskId: null,
    supersededTaskIds,
  };
}

export function createReusedTaskResult(task: TaskRecord): TaskCreateResult {
  return {
    task,
    deduplicated: true,
    disposition: "reused",
    reusedTaskId: task.id,
    supersededTaskIds: [],
  };
}

export function filterTasksByIdentifiers(tasks: TaskRecord[], query: TaskListQuery): TaskRecord[] {
  let filtered = tasks;
  if (query.taskIds?.length) {
    filtered = filtered.filter((task) => query.taskIds?.includes(task.id));
  }
  if (query.kinds?.length) {
    filtered = filtered.filter((task) => query.kinds?.includes(task.kind));
  }
  if (query.statuses?.length) {
    filtered = filtered.filter((task) => query.statuses?.includes(task.status));
  }
  return filtered;
}

export function filterTasksByChannels(tasks: TaskRecord[], query: TaskListQuery): TaskRecord[] {
  if (!query.channels?.length) {
    return tasks;
  }
  return tasks.filter((task) => {
    const taskChannels = [...task.channels, `task:${task.id}`, `kind:${task.kind}`];
    return taskChannels.some((channel) => query.channels?.includes(channel));
  });
}

export function filterTasksByKeys(tasks: TaskRecord[], query: TaskListQuery): TaskRecord[] {
  let filtered = tasks;
  if (query.dedupeKey) {
    filtered = filtered.filter((task) => task.dedupeKey === query.dedupeKey);
  }
  if (query.concurrencyKey) {
    filtered = filtered.filter((task) => task.concurrencyKey === query.concurrencyKey);
  }
  if (query.supersedeKey) {
    filtered = filtered.filter((task) => task.supersedeKey === query.supersedeKey);
  }
  return filtered;
}

export function createTaskStepRecord(input: TaskAppendStepInput, id: string): TaskStepRecord {
  return {
    id,
    taskId: input.taskId,
    attempt: input.attempt,
    kind: input.kind ?? "step",
    level: input.level ?? "info",
    message: input.message || input.label || "step",
    meta: input.meta ?? null,
    percent: input.percent ?? input.progressPercent ?? null,
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

export function clearTaskStaleState(task: TaskRecord): void {
  task.staleAt = null;
  task.staleReason = null;
}

export function releaseTaskLease(task: TaskRecord): void {
  task.leaseOwner = null;
  task.leaseToken = null;
  task.retryScheduledAt = null;
}

export function shouldMarkTaskStale(task: TaskRecord, reference: number, threshold: number): boolean {
  const running = task.status === "claimed" || task.status === "running";
  return running && !task.staleAt && reference < threshold;
}

export function isActiveTaskStatus(status: TaskRecord["status"]): boolean {
  return ACTIVE_TASK_STATUSES.has(status);
}
