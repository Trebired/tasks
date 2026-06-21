import type {
  TaskMarkStaleInput,
  TaskRecord,
  TaskStaleRequeueInput,
} from "#2kjvrax0gr4m";
import { nowIso, toErrorShape } from "#qysd2ddsh0x8";
import type { PostgresTaskStoreContext, TaskRow } from "./shared.js";
import { mapTaskRow } from "./shared.js";

async function markStaleTasks<TInput = unknown, TResult = unknown>(
  context: PostgresTaskStoreContext,
  input: TaskMarkStaleInput,
): Promise<TaskRecord<TInput, TResult>[]> {
  const current = nowIso(input.now);
  const threshold = nowIso(Date.parse(current) - input.staleAfterMs);
  const result = await context.client.query<TaskRow>(`
    update ${context.names.tasksQualified}
    set
      stale_at = coalesce(stale_at, $2::timestamptz),
      stale_reason = coalesce(stale_reason, $3),
      updated_at = $2::timestamptz
    where id in (
      select id
      from ${context.names.tasksQualified}
      where status in ('claimed', 'running')
        and coalesce(last_heartbeat_at, updated_at) < $1::timestamptz
        and stale_at is null
      order by updated_at asc
      limit $4
    )
    returning *
  `, [threshold, current, input.reason || "Task became stale", Math.max(1, input.limit ?? 100)]);
  return result.rows.map(mapTaskRow) as TaskRecord<TInput, TResult>[];
}

async function requeueStaleTasks(context: PostgresTaskStoreContext, input: TaskStaleRequeueInput = {}): Promise<number> {
  const current = nowIso(input.now);
  const stale = await readExpiredLeaseTasks(context, current, input.limit);
  let affected = 0;

  for (const row of stale.rows) {
    affected += await recoverExpiredLeaseTask(context, row, current);
  }

  return affected;
}

async function readExpiredLeaseTasks(
  context: PostgresTaskStoreContext,
  current: string,
  limit?: number,
) {
  return context.client.query<TaskRow>(`
    select *
    from ${context.names.tasksQualified}
    where status in ('claimed', 'running')
      and lease_expires_at is not null
      and lease_expires_at < $1::timestamptz
    order by lease_expires_at asc
    limit $2
  `, [current, Math.max(1, limit ?? 100)]);
}

async function recoverExpiredLeaseTask(context: PostgresTaskStoreContext, row: TaskRow, current: string): Promise<number> {
  if (Number(row.attempt || 0) >= Number(row.max_attempts || 1)) {
    return failExpiredLeaseTask(context, row.id, current);
  }

  return requeueExpiredLeaseTask(context, row.id, current);
}

async function failExpiredLeaseTask(context: PostgresTaskStoreContext, taskId: string, current: string): Promise<number> {
  const result = await context.client.query(`
    update ${context.names.tasksQualified}
    set
      status = 'failed',
      error = $2::jsonb,
      finished_at = $3::timestamptz,
      updated_at = $3::timestamptz,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      stale_at = $3::timestamptz,
      stale_reason = 'Task lease expired and max attempts were exhausted'
    where id = $1
      and status in ('claimed', 'running')
  `, [taskId, JSON.stringify(createLeaseExpiredError()), current]);
  return Number(result.rowCount || 0);
}

async function requeueExpiredLeaseTask(context: PostgresTaskStoreContext, taskId: string, current: string): Promise<number> {
  const result = await context.client.query(`
    update ${context.names.tasksQualified}
    set
      status = 'queued',
      error = $2::jsonb,
      progress_percent = null,
      progress_label = null,
      progress_meta = null,
      scheduled_at = $3::timestamptz,
      retry_scheduled_at = null,
      updated_at = $3::timestamptz,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      stale_at = $3::timestamptz,
      stale_reason = 'Task lease expired and was requeued'
    where id = $1
      and status in ('claimed', 'running')
  `, [taskId, JSON.stringify(createLeaseExpiredError()), current]);
  return Number(result.rowCount || 0);
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
