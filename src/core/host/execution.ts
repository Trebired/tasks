import type {
  TaskHandlerRegistration,
  TaskRecord,
} from "#2kjvrax0gr4m";
import { nowIso } from "#92c6666f713d";
import { emitTaskHostEvent } from "./context.js";
import type { RunningExecution, TaskHostContext } from "./context.js";
import { createExecutorEventListener } from "./execution/events.js";
import {
  failTaskExecution,
  handleLostTaskLease,
  settleTaskExecution,
} from "./execution/outcome.js";

type HostScheduler = () => Promise<void>;

async function startTaskExecution(
  context: TaskHostContext,
  task: TaskRecord,
  handler: TaskHandlerRegistration,
  schedulePump: HostScheduler,
): Promise<void> {
  if (!task.leaseToken) {
    return;
  }

  const currentTask = await markTaskRunning(context, task);
  emitRunningEvent(context, currentTask);

  try {
    const handle = await context.executor.execute({
      task: currentTask,
      handler,
      signal: new AbortController().signal,
      onEvent: createExecutorEventListener(context, currentTask),
    });
    await runExecution(context, currentTask, handle, handler, schedulePump);
  } catch (error) {
    await failTaskExecution(context, currentTask, error);
    await schedulePump();
  }
}

async function heartbeatTaskExecution(context: TaskHostContext, running: RunningExecution): Promise<void> {
  const renewed = await context.store.renewTaskLease({
    taskId: running.taskId,
    runnerId: context.runnerId,
    leaseToken: running.task.leaseToken || "",
    leaseMs: context.leaseMs,
    now: nowIso(),
  });

  if (!renewed) {
    await handleLostTaskLease(context, running);
    return;
  }

  running.task = renewed;
  if (renewed.cancelRequestedAt && !running.cancelRequested) {
    running.cancelRequested = true;
    await running.handle.cancel("Task cancellation requested");
  }
}

async function markTaskRunning(context: TaskHostContext, task: TaskRecord): Promise<TaskRecord> {
  return await context.store.markTaskRunning({
    taskId: task.id,
    runnerId: context.runnerId,
    leaseToken: task.leaseToken || "",
  }) || task;
}

function emitRunningEvent(context: TaskHostContext, task: TaskRecord): void {
  emitTaskHostEvent(context, {
    type: "task:running",
    timestamp: nowIso(),
    runnerId: context.runnerId,
    taskId: task.id,
    kind: task.kind,
    task,
  });
}

async function runExecution(
  context: TaskHostContext,
  task: TaskRecord,
  handle: RunningExecution["handle"],
  handler: TaskHandlerRegistration,
  schedulePump: HostScheduler,
): Promise<void> {
  const running: RunningExecution = {
    taskId: task.id,
    task,
    handle,
    cancelRequested: Boolean(task.cancelRequestedAt),
    heartbeatTimer: null,
    settled: Promise.resolve(),
  };

  context.running.set(task.id, running);
  running.heartbeatTimer = setInterval(() => {
    void heartbeatTaskExecution(context, running);
  }, context.heartbeatMs);
  running.heartbeatTimer.unref?.();

  running.settled = settleTaskExecution(context, running, handler, schedulePump);
  await running.settled;
}

export {
  heartbeatTaskExecution,
  settleTaskExecution,
  startTaskExecution,
};
