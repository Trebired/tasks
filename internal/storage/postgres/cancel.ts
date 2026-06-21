import type {
  TaskCancelInput,
  TaskRecord,
} from "#2kjvrax0gr4m";
import { nowIso, toErrorShape } from "#qysd2ddsh0x8";
import { getTask } from "./read.js";
import type { PostgresTaskStoreContext, TaskRow } from "./shared.js";
import { mapTaskRow } from "./shared.js";

async function cancelTask<TInput = unknown, TResult = unknown>(
  context: PostgresTaskStoreContext,
  input: TaskCancelInput,
): Promise<TaskRecord<TInput, TResult> | null> {
  const current = nowIso(input.requestedAt);
  const reason = input.reason
    ? toErrorShape({ message: input.reason, code: "TASK_CANCELLED" })
    : toErrorShape({ message: "Task cancelled", code: "TASK_CANCELLED" });
  const existing = await getTask<TInput, TResult>(context, input.taskId);

  if (!existing) {
    return null;
  }

  if (existing.status === "queued") {
    return cancelQueuedTask(context, input.taskId, current, reason, existing);
  }

  if (existing.status === "claimed" || existing.status === "running") {
    return cancelRunningTask(context, input.taskId, current, reason, existing);
  }

  return existing;
}

async function cancelQueuedTask<TInput, TResult>(
  context: PostgresTaskStoreContext,
  taskId: string,
  current: string,
  reason: ReturnType<typeof toErrorShape>,
  existing: TaskRecord<TInput, TResult>,
): Promise<TaskRecord<TInput, TResult>> {
  const result = await context.client.query<TaskRow>(`
    update ${context.names.tasksQualified}
    set
      status = 'cancelled',
      error = $2::jsonb,
      cancel_requested_at = $3::timestamptz,
      finished_at = $3::timestamptz,
      updated_at = $3::timestamptz,
      retry_scheduled_at = null
    where id = $1
      and status = 'queued'
    returning *
  `, [taskId, JSON.stringify(reason), current]);
  return (result.rows[0] ? mapTaskRow(result.rows[0]) : existing) as TaskRecord<TInput, TResult>;
}

async function cancelRunningTask<TInput, TResult>(
  context: PostgresTaskStoreContext,
  taskId: string,
  current: string,
  reason: ReturnType<typeof toErrorShape>,
  existing: TaskRecord<TInput, TResult>,
): Promise<TaskRecord<TInput, TResult>> {
  const result = await context.client.query<TaskRow>(`
    update ${context.names.tasksQualified}
    set
      cancel_requested_at = coalesce(cancel_requested_at, $2::timestamptz),
      error = coalesce(error, $3::jsonb),
      updated_at = $2::timestamptz
    where id = $1
      and status in ('claimed', 'running')
    returning *
  `, [taskId, current, JSON.stringify(reason)]);
  return (result.rows[0] ? mapTaskRow(result.rows[0]) : existing) as TaskRecord<TInput, TResult>;
}

export {
  cancelTask,
};
