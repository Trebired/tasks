import type {
  TaskCancelRunningInput,
  TaskFailureInput,
  TaskRecord,
  TaskRetryInput,
} from "#2kjvrax0gr4m";
import { nowIso, toErrorShape } from "#qysd2ddsh0x8";
import type { SqliteTaskRow, SqliteTaskStoreContext } from "./shared.js";
import {
  executeGet,
  executeRun,
  mapSqliteTaskRow,
  readSqliteChanges,
} from "./shared.js";

async function markTaskFailed<TInput = unknown, TResult = unknown>(
  context: SqliteTaskStoreContext,
  input: TaskFailureInput,
): Promise<TaskRecord<TInput, TResult> | null> {
  const current = nowIso(input.finishedAt);

  const updated = executeRun(
    context.db,
    `
      update "${context.names.tasksTable}"
      set
        status = 'failed',
        error = ?,
        finished_at = ?,
        updated_at = ?,
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null,
        retry_scheduled_at = null
      where id = ?
        and lease_owner = ?
        and lease_token = ?
        and status in ('claimed', 'running')
    `,
    [
      JSON.stringify(input.error || toErrorShape("Task failed")),
      current,
      current,
      input.taskId,
      input.runnerId,
      input.leaseToken,
    ],
  );

  return readSqliteChanges(updated)
    ? readCompletionTask<TInput, TResult>(context, input.taskId)
    : null;
}

async function markTaskCancelled<TInput = unknown, TResult = unknown>(
  context: SqliteTaskStoreContext,
  input: TaskCancelRunningInput,
): Promise<TaskRecord<TInput, TResult> | null> {
  const current = nowIso(input.finishedAt);
  const reason = input.reason
    ? toErrorShape({ message: input.reason, code: "TASK_CANCELLED" })
    : toErrorShape({ message: "Task cancelled", code: "TASK_CANCELLED" });

  const updated = executeRun(
    context.db,
    `
      update "${context.names.tasksTable}"
      set
        status = 'cancelled',
        error = ?,
        finished_at = ?,
        updated_at = ?,
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null,
        retry_scheduled_at = null
      where id = ?
        and lease_owner = ?
        and lease_token = ?
        and status in ('claimed', 'running')
    `,
    [JSON.stringify(reason), current, current, input.taskId, input.runnerId, input.leaseToken],
  );

  return readSqliteChanges(updated)
    ? readCompletionTask<TInput, TResult>(context, input.taskId)
    : null;
}

async function requeueTask<TInput = unknown, TResult = unknown>(
  context: SqliteTaskStoreContext,
  input: TaskRetryInput,
): Promise<TaskRecord<TInput, TResult> | null> {
  const updated = executeRun(
    context.db,
    `
      update "${context.names.tasksTable}"
      set
        status = 'queued',
        error = ?,
        progress_percent = null,
        progress_label = null,
        progress_meta = null,
        scheduled_at = ?,
        retry_scheduled_at = ?,
        updated_at = ?,
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null,
        stale_at = null,
        stale_reason = null
      where id = ?
        and lease_owner = ?
        and lease_token = ?
        and status in ('claimed', 'running')
    `,
    [
      JSON.stringify(input.error),
      nowIso(input.scheduledAt),
      nowIso(input.scheduledAt),
      nowIso(),
      input.taskId,
      input.runnerId,
      input.leaseToken,
    ],
  );

  return readSqliteChanges(updated)
    ? readCompletionTask<TInput, TResult>(context, input.taskId)
    : null;
}

function readCompletionTask<TInput, TResult>(
  context: SqliteTaskStoreContext,
  taskId: string,
): TaskRecord<TInput, TResult> | null {
  const row = executeGet<SqliteTaskRow>(
    context.db,
    `select * from "${context.names.tasksTable}" where id = ? limit 1`,
    [taskId],
  );

  return (row ? mapSqliteTaskRow(row) : null) as TaskRecord<TInput, TResult> | null;
}

export {
  markTaskCancelled,
  markTaskFailed,
  requeueTask,
};
