import type {
  TaskExecutorOutcome,
  TaskHandlerRegistration,
  TaskRecord,
  TaskTerminalError,
} from "#2kjvrax0gr4m";
import { resolveRetryDecision } from "#9cba595a238d";
import { nowIso, toErrorShape } from "#92c6666f713d";
import { emitTaskHostEvent } from "#yjfcvxwh42t2";
import type { RunningExecution, TaskHostContext } from "#yjfcvxwh42t2";

async function settleTaskExecution(
  context: TaskHostContext,
  running: RunningExecution,
  handler: TaskHandlerRegistration,
  schedulePump: () => Promise<void>,
): Promise<void> {
  const outcome = await resolveTaskOutcome(running);
  clearHeartbeatTimer(running);

  try {
    await settleTaskOutcome(context, running, handler, outcome);
  } finally {
    context.running.delete(running.taskId);
    if (context.state === "running") {
      await schedulePump();
    }
  }
}

async function handleLostTaskLease(context: TaskHostContext, running: RunningExecution): Promise<void> {
  clearHeartbeatTimer(running);
  await running.handle.cancel("Task lease lost");
  emitTaskHostEvent(context, {
    type: "task:lease_lost",
    timestamp: nowIso(),
    runnerId: context.runnerId,
    taskId: running.task.id,
    kind: running.task.kind,
    task: running.task,
  });
}

async function failTaskExecution(context: TaskHostContext, task: TaskRecord, error: unknown): Promise<void> {
  const failed = await context.store.markTaskFailed({
    taskId: task.id,
    runnerId: context.runnerId,
    leaseToken: task.leaseToken || "",
    error: toErrorShape(error),
    finishedAt: nowIso(),
  });
  emitTaskHostEvent(context, {
    type: "task:failed",
    timestamp: nowIso(),
    runnerId: context.runnerId,
    taskId: task.id,
    kind: task.kind,
    task: failed,
    error,
  });
}

async function resolveTaskOutcome(running: RunningExecution): Promise<TaskExecutorOutcome> {
  try {
    return await running.handle.completion;
  } catch (error) {
    return {
      status: running.cancelRequested ? "cancelled" : "failed",
      error: toErrorShape(error),
    };
  }
}

async function settleTaskOutcome(
  context: TaskHostContext,
  running: RunningExecution,
  handler: TaskHandlerRegistration,
  outcome: TaskExecutorOutcome,
): Promise<void> {
  if (outcome.status === "succeeded") {
    await markTaskSucceeded(context, running, outcome.output);
    return;
  }

  if (outcome.status === "cancelled" || running.cancelRequested) {
    await markTaskCancelled(context, running, outcome.error?.message);
    return;
  }

  await handleTaskFailureOutcome(context, running, handler, outcome.error || toErrorShape("Task failed"));
}

async function markTaskSucceeded(context: TaskHostContext, running: RunningExecution, output: unknown): Promise<void> {
  const task = await context.store.markTaskSucceeded({
    taskId: running.task.id,
    runnerId: context.runnerId,
    leaseToken: running.task.leaseToken || "",
    output,
    finishedAt: nowIso(),
  });
  emitTaskHostEvent(context, {
    type: "task:succeeded",
    timestamp: nowIso(),
    runnerId: context.runnerId,
    taskId: running.task.id,
    kind: running.task.kind,
    task,
    output,
  });
}

async function markTaskCancelled(context: TaskHostContext, running: RunningExecution, reason?: string): Promise<void> {
  const task = await context.store.markTaskCancelled({
    taskId: running.task.id,
    runnerId: context.runnerId,
    leaseToken: running.task.leaseToken || "",
    reason: reason || "Task cancelled",
    finishedAt: nowIso(),
  });
  emitTaskHostEvent(context, {
    type: "task:cancelled",
    timestamp: nowIso(),
    runnerId: context.runnerId,
    taskId: running.task.id,
    kind: running.task.kind,
    task,
  });
}

async function handleTaskFailureOutcome(
  context: TaskHostContext,
  running: RunningExecution,
  handler: TaskHandlerRegistration,
  error: TaskTerminalError,
): Promise<void> {
  const retry = await resolveRetryDecision({
    task: running.task,
    handler,
    error,
    defaultMaxAttempts: context.defaultMaxAttempts,
  });
  if (retry.retry && retry.scheduledAt) {
    await requeueFailedTask(context, running, error, retry.scheduledAt);
    return;
  }

  const task = await context.store.markTaskFailed({
    taskId: running.task.id,
    runnerId: context.runnerId,
    leaseToken: running.task.leaseToken || "",
    error,
    finishedAt: nowIso(),
  });
  emitTaskHostEvent(context, {
    type: "task:failed",
    timestamp: nowIso(),
    runnerId: context.runnerId,
    taskId: running.task.id,
    kind: running.task.kind,
    task,
    error,
  });
}

async function requeueFailedTask(
  context: TaskHostContext,
  running: RunningExecution,
  error: TaskTerminalError,
  scheduledAt: string | Date | number,
): Promise<void> {
  const task = await context.store.requeueTask({
    taskId: running.task.id,
    runnerId: context.runnerId,
    leaseToken: running.task.leaseToken || "",
    error,
    scheduledAt: nowIso(scheduledAt),
  });
  emitTaskHostEvent(context, {
    type: "task:retry",
    timestamp: nowIso(),
    runnerId: context.runnerId,
    taskId: running.task.id,
    kind: running.task.kind,
    task,
    error,
  });
}

function clearHeartbeatTimer(running: RunningExecution): void {
  if (running.heartbeatTimer) {
    clearInterval(running.heartbeatTimer);
    running.heartbeatTimer = null;
  }
}

export {
  failTaskExecution,
  handleLostTaskLease,
  settleTaskExecution,
};
