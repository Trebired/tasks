import type {
  TaskMarkStaleInput,
  TaskRecord,
  TaskStaleRequeueInput,
} from "#2kjvrax0gr4m";
import { nowIso, toErrorShape } from "#qysd2ddsh0x8";
import type { SqliteTaskRow, SqliteTaskStoreContext } from "./shared.js";
import {
  executeAll,
  executeRun,
  mapSqliteTaskRow,
} from "./shared.js";

async function markStaleTasks<TInput = unknown, TResult = unknown>(
  context: SqliteTaskStoreContext,
  input: TaskMarkStaleInput,
): Promise<TaskRecord<TInput, TResult>[]> {
  const current = nowIso(input.now);
  const threshold = nowIso(Date.parse(current) - input.staleAfterMs);
  const rows = executeAll<SqliteTaskRow>(
    context.db,
    `
      select *
      from "${context.names.tasksTable}"
      where status in ('claimed', 'running')
        and coalesce(last_heartbeat_at, updated_at) < ?
        and stale_at is null
      order by updated_at asc
      limit ?
    `,
    [threshold, Math.max(1, input.limit ?? 100)],
  );

  for (const row of rows) {
    executeRun(
      context.db,
      `
        update "${context.names.tasksTable}"
        set
          stale_at = coalesce(stale_at, ?),
          stale_reason = coalesce(stale_reason, ?),
          updated_at = ?
        where id = ?
      `,
      [current, input.reason || "Task became stale", current, row.id],
    );
  }

  return rows.map((row) => mapSqliteTaskRow({
    ...row,
    stale_at: current,
    stale_reason: row.stale_reason || input.reason || "Task became stale",
    updated_at: current,
  })) as TaskRecord<TInput, TResult>[];
}

async function requeueStaleTasks(context: SqliteTaskStoreContext, input: TaskStaleRequeueInput = {}): Promise<number> {
  const current = nowIso(input.now);
  const rows = executeAll<SqliteTaskRow>(
    context.db,
    `
      select *
      from "${context.names.tasksTable}"
      where status in ('claimed', 'running')
        and lease_expires_at is not null
        and lease_expires_at < ?
      order by lease_expires_at asc
      limit ?
    `,
    [current, Math.max(1, input.limit ?? 100)],
  );

  let affected = 0;
  for (const row of rows) {
    affected += recoverExpiredLeaseTask(context, row, current);
  }

  return affected;
}

function recoverExpiredLeaseTask(context: SqliteTaskStoreContext, row: SqliteTaskRow, current: string): number {
  return Number(row.attempt || 0) >= Number(row.max_attempts || 1)
    ? failExpiredLeaseTask(context, row.id, current)
    : requeueExpiredLeaseTask(context, row.id, current);
}

function failExpiredLeaseTask(context: SqliteTaskStoreContext, taskId: string, current: string): number {
  executeRun(
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
        stale_at = ?,
        stale_reason = 'Task lease expired and max attempts were exhausted'
      where id = ?
        and status in ('claimed', 'running')
    `,
    [JSON.stringify(createLeaseExpiredError()), current, current, current, taskId],
  );

  return 1;
}

function requeueExpiredLeaseTask(context: SqliteTaskStoreContext, taskId: string, current: string): number {
  executeRun(
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
        retry_scheduled_at = null,
        updated_at = ?,
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null,
        stale_at = ?,
        stale_reason = 'Task lease expired and was requeued'
      where id = ?
        and status in ('claimed', 'running')
    `,
    [JSON.stringify(createLeaseExpiredError()), current, current, current, taskId],
  );

  return 1;
}

function createLeaseExpiredError() {
  return toErrorShape({
    message: "Task lease expired and was recovered",
    code: "TASK_LEASE_EXPIRED",
  });
}

export {
  markStaleTasks,
  requeueStaleTasks,
};
