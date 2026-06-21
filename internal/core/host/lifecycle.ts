import { TASKS_LOG_GROUP } from "#5dtdwzlie8fm";
import { emitTaskHostEvent } from "./context.js";
import type { TaskHostContext } from "./context.js";
import { startTaskExecution } from "./execution.js";
import {
  markWatchdogStaleTasks,
  recoverStaleTaskLeases,
  scheduleTaskHostPump,
  waitForRunningExecutions,
} from "./pump.js";
import { nowIso, withTimeout } from "#92c6666f713d";

async function startTaskHost(context: TaskHostContext): Promise<void> {
  if (context.state === "running") {
    return;
  }

  if (context.state === "stopping") {
    await stopTaskHost(context);
  }

  context.state = "running";
  emitTaskHostEvent(context, createRunnerEvent(context, "runner:start"));
  logTaskRunnerStart(context);

  const schedulePump = createPumpScheduler(context);
  await recoverStaleTaskLeases(context, schedulePump);
  await markWatchdogStaleTasks(context);
  startTaskHostTimers(context, schedulePump);
  await schedulePump();
}

async function stopTaskHost(context: TaskHostContext): Promise<void> {
  if (context.state === "idle" || context.state === "stopped") {
    context.state = "stopped";
    return;
  }

  if (context.state === "stopping") {
    await waitForRunningExecutions(context);
    context.state = "stopped";
    return;
  }

  context.state = "stopping";
  clearTaskHostTimers(context);
  if (context.pumpPromise) {
    await context.pumpPromise;
  }

  await stopRunningExecutions(context);
  context.state = "stopped";
  emitTaskHostEvent(context, createRunnerEvent(context, "runner:stop"));
}

function createPumpScheduler(context: TaskHostContext): () => Promise<void> {
  return () => scheduleTaskHostPump(context, (task, handler) => startTaskExecution(context, task, handler, createPumpScheduler(context)));
}

function startTaskHostTimers(context: TaskHostContext, schedulePump: () => Promise<void>): void {
  context.pollTimer = createTimer(context.pollIntervalMs, schedulePump);
  context.staleTimer = createTimer(context.staleScanIntervalMs, () => recoverStaleTaskLeases(context, schedulePump));

  if (context.watchdogMs > 0) {
    context.watchdogTimer = createTimer(context.watchdogScanIntervalMs, () => markWatchdogStaleTasks(context));
  }

  if (context.retentionPolicy) {
    context.retentionTimer = createTimer(context.retentionScanIntervalMs, () => context.store.applyRetentionPolicy(context.retentionPolicy!));
  }
}

function createTimer(intervalMs: number, run: () => Promise<unknown>): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    void run();
  }, intervalMs);
  timer.unref?.();
  return timer;
}

function clearTaskHostTimers(context: TaskHostContext): void {
  for (const timer of [context.pollTimer, context.staleTimer, context.watchdogTimer, context.retentionTimer]) {
    if (timer) {
      clearInterval(timer);
    }
  }

  context.pollTimer = null;
  context.staleTimer = null;
  context.watchdogTimer = null;
  context.retentionTimer = null;
}

async function stopRunningExecutions(context: TaskHostContext): Promise<void> {
  try {
    await withTimeout(waitForRunningExecutions(context), context.stopTimeoutMs);
  } catch {
    await cancelRunningExecutions(context);
    await waitForRunningExecutions(context);
  }
}

async function cancelRunningExecutions(context: TaskHostContext): Promise<void> {
  for (const execution of context.running.values()) {
    await execution.handle.cancel("Task runner stopping");
  }
}

function createRunnerEvent(context: TaskHostContext, type: "runner:start" | "runner:stop") {
  return {
    type,
    timestamp: nowIso(),
    runnerId: context.runnerId,
  };
}

function logTaskRunnerStart(context: TaskHostContext): void {
  context.logger.info(TASKS_LOG_GROUP, "task runner started", {
    runnerId: context.runnerId,
    concurrency: context.globalConcurrency,
  });
}

export {
  startTaskHost,
  stopTaskHost,
};
