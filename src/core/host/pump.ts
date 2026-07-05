import type { TaskHandlerRegistration, TaskRecord } from "#2kjvrax0gr4m";
import { nowIso, sleep, toErrorShape } from "#92c6666f713d";
import { emitTaskHostEvent, getPerKindConcurrency } from "./context.js";
import type { TaskHostContext } from "./context.js";

type RunTaskExecution = (task: TaskRecord, handler: TaskHandlerRegistration) => Promise<void>;

async function scheduleTaskHostPump(context: TaskHostContext, runTaskExecution: RunTaskExecution): Promise<void> {
  if (context.state !== "running" || context.pumpPromise) {
    return;
  }

  context.pumpPromise = pumpTaskHost(context, runTaskExecution).finally(() => {
    context.pumpPromise = null;
  });
  await context.pumpPromise;
}

async function recoverStaleTaskLeases(context: TaskHostContext, schedulePump: () => Promise<void>): Promise<void> {
  const recovered = await context.store.requeueStaleTasks({
    limit: context.staleScanLimit,
    now: nowIso(),
  });
  if (recovered <= 0) {
    return;
  }

  emitTaskHostEvent(context, {
    type: "task:stale_requeued",
    timestamp: nowIso(),
    runnerId: context.runnerId,
    count: recovered,
  });
  await schedulePump();
}

async function markWatchdogStaleTasks(context: TaskHostContext): Promise<void> {
  if (context.watchdogMs <= 0) {
    return;
  }

  const stale = await context.store.markStaleTasks({
    staleAfterMs: context.watchdogMs,
    limit: context.staleScanLimit,
    now: nowIso(),
    reason: "Task stopped reporting progress or heartbeat",
  });

  for (const task of stale) {
    emitTaskHostEvent(context, {
      type: "task:stale",
      timestamp: nowIso(),
      runnerId: context.runnerId,
      taskId: task.id,
      kind: task.kind,
      task,
    });
  }
}

async function waitForRunningExecutions(context: TaskHostContext): Promise<void> {
  while (context.running.size > 0) {
    await Promise.all([...context.running.values()].map((execution) => execution.settled));
    if (context.running.size > 0) {
      await sleep(10);
    }
  }
}

async function pumpTaskHost(context: TaskHostContext, runTaskExecution: RunTaskExecution): Promise<void> {
  while (canClaimAnotherTask(context)) {
    const task = await context.store.claimNextTask({
      runnerId: context.runnerId,
      leaseMs: context.leaseMs,
      kinds: [...context.handlers.keys()],
      globalConcurrency: context.globalConcurrency,
      perKindConcurrency: getPerKindConcurrency(context),
      now: nowIso(),
    });
    if (!task) {
      return;
    }

    await claimOrFailTask(context, task, runTaskExecution);
  }
}

function canClaimAnotherTask(context: TaskHostContext): boolean {
  return context.state === "running" && context.running.size < context.globalConcurrency;
}

async function claimOrFailTask(
  context: TaskHostContext,
  task: TaskRecord,
  runTaskExecution: RunTaskExecution,
): Promise<void> {
  const handler = context.handlers.get(task.kind);
  if (!handler || !task.leaseToken) {
    await failMissingHandlerTask(context, task);
    return;
  }

  emitTaskHostEvent(context, {
    type: "task:claimed",
    timestamp: nowIso(),
    runnerId: context.runnerId,
    taskId: task.id,
    kind: task.kind,
    task,
  });
  void runTaskExecution(task, handler);
}

async function failMissingHandlerTask(context: TaskHostContext, task: TaskRecord): Promise<void> {
  await context.store.markTaskFailed({
    taskId: task.id,
    runnerId: context.runnerId,
    leaseToken: task.leaseToken || "",
    error: toErrorShape(`No handler registered for task kind "${task.kind}"`),
    finishedAt: nowIso(),
  });
}

export {
  markWatchdogStaleTasks,
  recoverStaleTaskLeases,
  scheduleTaskHostPump,
  waitForRunningExecutions,
};
