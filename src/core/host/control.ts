import type {
  TaskEnqueueOptions,
  TaskEnqueueResult,
  TaskHandlerRegistration,
  TaskRecord,
} from "#2kjvrax0gr4m";
import { emitTaskHostEvent } from "./context.js";
import type { TaskHostContext } from "./context.js";
import { nowIso, taskId } from "#92c6666f713d";

async function enqueueTask<TInput = unknown>(
  context: TaskHostContext,
  kind: string,
  input: TInput,
  options: TaskEnqueueOptions = {},
): Promise<TaskEnqueueResult> {
  const handler = context.handlers.get(kind);
  const maxAttempts = resolveMaxAttempts(context, handler, options);
  const result = await context.store.createTask({
    id: taskId(options.id),
    kind,
    input,
    metadata: options.metadata ?? handler?.metadata ?? null,
    concurrencyKey: options.concurrencyKey ?? null,
    dedupeKey: options.dedupeKey ?? null,
    supersedeKey: options.supersedeKey ?? null,
    supersedeExisting: options.supersedeExisting ?? false,
    channels: options.channels ?? null,
    maxAttempts,
    scheduledAt: nowIso(options.scheduledAt),
  });

  emitTaskHostEvent(context, {
    type: "task:enqueued",
    timestamp: nowIso(),
    runnerId: context.runnerId,
    taskId: result.task.id,
    kind: result.task.kind,
    task: result.task,
    deduplicated: result.deduplicated,
    disposition: result.disposition,
    supersededTaskIds: result.supersededTaskIds,
  });

  return result;
}

async function cancelTask(context: TaskHostContext, taskId: string, reason?: string): Promise<TaskRecord | null> {
  const task = await context.store.cancelTask({
    taskId,
    reason,
    requestedAt: nowIso(),
  });
  const running = task ? context.running.get(task.id) : null;
  if (running) {
    running.cancelRequested = true;
    await running.handle.cancel(reason || "Task cancelled");
  }

  if (task && task.status === "cancelled") {
    emitTaskHostEvent(context, {
      type: "task:cancelled",
      timestamp: nowIso(),
      runnerId: context.runnerId,
      taskId: task.id,
      kind: task.kind,
      task,
    });
  }

  return task;
}

function resolveMaxAttempts(
  context: TaskHostContext,
  handler: TaskHandlerRegistration | undefined,
  options: TaskEnqueueOptions,
): number {
  return Math.max(
    1,
    options.maxAttempts
      ?? handler?.retry?.maxAttempts
      ?? context.defaultMaxAttempts,
  );
}

export {
  cancelTask,
  enqueueTask,
};
