import type {
  TaskExecutorProgressEvent,
  TaskRecord,
} from "#2kjvrax0gr4m";
import { clampPercent, nowIso } from "#92c6666f713d";
import { emitTaskHostEvent } from "#yjfcvxwh42t2";
import type { TaskHostContext } from "#yjfcvxwh42t2";

function createExecutorEventListener(context: TaskHostContext, task: TaskRecord) {
  return async (event: TaskExecutorProgressEvent) => {
    if (event.type === "progress") {
      await handleTaskProgressEvent(context, task, event.progress);
      return;
    }

    await handleTaskStepEvent(context, task, event.step);
  };
}

async function handleTaskProgressEvent(
  context: TaskHostContext,
  task: TaskRecord,
  progress: {
    percent?: number | null;
    label?: string | null;
    meta?: Record<string, unknown> | null;
  },
): Promise<void> {
  const updated = await context.store.updateTaskProgress({
    taskId: task.id,
    runnerId: context.runnerId,
    leaseToken: task.leaseToken || "",
    percent: clampPercent(progress.percent),
    label: progress.label ?? null,
    meta: progress.meta ?? null,
    updatedAt: nowIso(),
  });
  mergeUpdatedTask(task, updated);
  emitTaskHostEvent(context, {
    type: "task:progress",
    timestamp: nowIso(),
    runnerId: context.runnerId,
    taskId: task.id,
    kind: task.kind,
    task: updated || task,
  });
}

async function handleTaskStepEvent(
  context: TaskHostContext,
  task: TaskRecord,
  stepInput: Exclude<TaskExecutorProgressEvent, {
    type: "progress";
  }>["step"],
): Promise<void> {
  const step = await context.store.appendTaskStep({
    taskId: task.id,
    runnerId: context.runnerId,
    leaseToken: task.leaseToken || "",
    attempt: task.attempt,
    kind: stepInput.kind ?? "step",
    level: stepInput.level ?? "info",
    message: stepInput.message || stepInput.label || "step",
    meta: stepInput.meta ?? null,
    percent: stepInput.percent ?? stepInput.progressPercent ?? null,
    createdAt: nowIso(),
  });
  await updateTaskPercentFromStep(context, task, stepInput);
  emitTaskHostEvent(context, {
    type: "task:step",
    timestamp: nowIso(),
    runnerId: context.runnerId,
    taskId: task.id,
    kind: task.kind,
    task,
    step,
  });
}

async function updateTaskPercentFromStep(
  context: TaskHostContext,
  task: TaskRecord,
  stepInput: {
    percent?: number | null;
    progressPercent?: number | null;
  },
): Promise<void> {
  const progressPercent = stepInput.percent ?? stepInput.progressPercent;
  if (progressPercent == null) {
    return;
  }

  const updated = await context.store.updateTaskProgress({
    taskId: task.id,
    runnerId: context.runnerId,
    leaseToken: task.leaseToken || "",
    percent: progressPercent,
    updatedAt: nowIso(),
  });
  mergeUpdatedTask(task, updated);
}

function mergeUpdatedTask(task: TaskRecord, updated: TaskRecord | null): void {
  if (!updated) {
    return;
  }

  task.progressPercent = updated.progressPercent;
  task.progressLabel = updated.progressLabel;
  task.progressMeta = updated.progressMeta;
  task.updatedAt = updated.updatedAt;
  task.staleAt = updated.staleAt;
  task.staleReason = updated.staleReason;
}

export {
  createExecutorEventListener,
};
