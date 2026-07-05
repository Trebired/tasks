import type {
  TaskCancelInput,
  TaskRecord,
} from "#2kjvrax0gr4m";
import { nowIso, toErrorShape } from "#qysd2ddsh0x8";
import { getTask } from "./read.js";
import type { SqliteTaskStoreContext } from "./shared.js";
import { executeRun } from "./shared.js";

async function cancelTask<TInput = unknown, TResult = unknown>(
  context: SqliteTaskStoreContext,
  input: TaskCancelInput,
): Promise<TaskRecord<TInput, TResult> | null> {
  const current = nowIso(input.requestedAt);
  const reason = createCancellationReason(input.reason);
  const existing = await getTask<TInput, TResult>(context, input.taskId);

  if (!existing) {
    return null;
  }

  if (existing.status === "queued") {
    cancelQueuedTask(context, input.taskId, current, reason);
    return await getTask<TInput, TResult>(context, input.taskId);
  }

  if (existing.status === "claimed" || existing.status === "running") {
    cancelRunningTask(context, input.taskId, current, reason);
    return await getTask<TInput, TResult>(context, input.taskId);
  }

  return existing;
}

function createCancellationReason(reason?: string) {
  return reason
    ? toErrorShape({ message: reason, code: "TASK_CANCELLED" })
    : toErrorShape({ message: "Task cancelled", code: "TASK_CANCELLED" });
}

function cancelQueuedTask(
  context: SqliteTaskStoreContext,
  taskId: string,
  current: string,
  reason: ReturnType<typeof toErrorShape>,
): void {
  executeRun(
    context.db,
    `
      update "${context.names.tasksTable}"
      set
        status = 'cancelled',
        error = ?,
        cancel_requested_at = ?,
        finished_at = ?,
        updated_at = ?,
        retry_scheduled_at = null
      where id = ?
        and status = 'queued'
    `,
    [JSON.stringify(reason), current, current, current, taskId],
  );
}

function cancelRunningTask(
  context: SqliteTaskStoreContext,
  taskId: string,
  current: string,
  reason: ReturnType<typeof toErrorShape>,
): void {
  executeRun(
    context.db,
    `
      update "${context.names.tasksTable}"
      set
        cancel_requested_at = coalesce(cancel_requested_at, ?),
        error = coalesce(error, ?),
        updated_at = ?
      where id = ?
        and status in ('claimed', 'running')
    `,
    [current, JSON.stringify(reason), current, taskId],
  );
}

export {
  cancelTask,
};
