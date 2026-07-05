import type {
  TaskCancelRunningInput,
  TaskFailureInput,
  TaskRecord,
  TaskRetryInput,
} from "#2kjvrax0gr4m";
import { nowIso, toErrorShape } from "#qysd2ddsh0x8";
import type { PostgresTaskStoreContext, TaskRow } from "./shared.js";
import { mapTaskRow } from "./shared.js";

async function markTaskFailed<TInput = unknown, TResult = unknown>(
  context: PostgresTaskStoreContext,
  input: TaskFailureInput,
): Promise<TaskRecord<TInput, TResult> | null> {
  const error = input.error || toErrorShape("Task failed");
  const result = await context.client.query<TaskRow>(`
    update ${context.names.tasksQualified}
    set
      status = 'failed',
      error = $4::jsonb,
      finished_at = $5::timestamptz,
      updated_at = $5::timestamptz,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      retry_scheduled_at = null
    where id = $1
      and lease_owner = $2
      and lease_token = $3
      and status in ('claimed', 'running')
    returning *
  `, [input.taskId, input.runnerId, input.leaseToken, JSON.stringify(error), nowIso(input.finishedAt)]);
  return (result.rows[0] ? mapTaskRow(result.rows[0]) : null) as TaskRecord<TInput, TResult> | null;
}

async function markTaskCancelled<TInput = unknown, TResult = unknown>(
  context: PostgresTaskStoreContext,
  input: TaskCancelRunningInput,
): Promise<TaskRecord<TInput, TResult> | null> {
  const reason = input.reason
    ? toErrorShape({ message: input.reason, code: "TASK_CANCELLED" })
    : toErrorShape({ message: "Task cancelled", code: "TASK_CANCELLED" });
  const result = await context.client.query<TaskRow>(`
    update ${context.names.tasksQualified}
    set
      status = 'cancelled',
      error = $4::jsonb,
      finished_at = $5::timestamptz,
      updated_at = $5::timestamptz,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      retry_scheduled_at = null
    where id = $1
      and lease_owner = $2
      and lease_token = $3
      and status in ('claimed', 'running')
    returning *
  `, [input.taskId, input.runnerId, input.leaseToken, JSON.stringify(reason), nowIso(input.finishedAt)]);
  return (result.rows[0] ? mapTaskRow(result.rows[0]) : null) as TaskRecord<TInput, TResult> | null;
}

async function requeueTask<TInput = unknown, TResult = unknown>(
  context: PostgresTaskStoreContext,
  input: TaskRetryInput,
): Promise<TaskRecord<TInput, TResult> | null> {
  const result = await context.client.query<TaskRow>(`
    update ${context.names.tasksQualified}
    set
      status = 'queued',
      error = $4::jsonb,
      progress_percent = null,
      progress_label = null,
      progress_meta = null,
      scheduled_at = $5::timestamptz,
      retry_scheduled_at = $5::timestamptz,
      updated_at = now(),
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      stale_at = null,
      stale_reason = null
    where id = $1
      and lease_owner = $2
      and lease_token = $3
      and status in ('claimed', 'running')
    returning *
  `, [input.taskId, input.runnerId, input.leaseToken, JSON.stringify(input.error), nowIso(input.scheduledAt)]);
  return (result.rows[0] ? mapTaskRow(result.rows[0]) : null) as TaskRecord<TInput, TResult> | null;
}

export {
  markTaskCancelled,
  markTaskFailed,
  requeueTask,
};
