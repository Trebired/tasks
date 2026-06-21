import type {
  TaskAppendStepInput,
  TaskLeaseInput,
  TaskLeaseRenewalInput,
  TaskRecord,
  TaskStepRecord,
  TaskSuccessInput,
  TaskUpdateProgressInput,
} from "#2kjvrax0gr4m";
import { clampPercent, nowIso } from "#qysd2ddsh0x8";
import type { PostgresTaskStoreContext, TaskRow, TaskStepRow } from "./shared.js";
import { mapStepRow, mapTaskRow } from "./shared.js";

async function markTaskRunning<TInput = unknown, TResult = unknown>(
  context: PostgresTaskStoreContext,
  input: TaskLeaseInput,
): Promise<TaskRecord<TInput, TResult> | null> {
  const result = await context.client.query<TaskRow>(`
    update ${context.names.tasksQualified}
    set
      status = 'running',
      started_at = coalesce(started_at, now()),
      updated_at = now(),
      stale_at = null,
      stale_reason = null
    where id = $1
      and lease_owner = $2
      and lease_token = $3
      and status in ('claimed', 'running')
    returning *
  `, [input.taskId, input.runnerId, input.leaseToken]);
  return (result.rows[0] ? mapTaskRow(result.rows[0]) : null) as TaskRecord<TInput, TResult> | null;
}

async function renewTaskLease<TInput = unknown, TResult = unknown>(
  context: PostgresTaskStoreContext,
  input: TaskLeaseRenewalInput,
): Promise<TaskRecord<TInput, TResult> | null> {
  const current = nowIso(input.now);
  const result = await context.client.query<TaskRow>(`
    update ${context.names.tasksQualified}
    set
      lease_expires_at = $4::timestamptz,
      last_heartbeat_at = $5::timestamptz,
      updated_at = $5::timestamptz,
      stale_at = null,
      stale_reason = null
    where id = $1
      and lease_owner = $2
      and lease_token = $3
      and status in ('claimed', 'running')
    returning *
  `, [input.taskId, input.runnerId, input.leaseToken, nowIso(Date.parse(current) + input.leaseMs), current]);
  return (result.rows[0] ? mapTaskRow(result.rows[0]) : null) as TaskRecord<TInput, TResult> | null;
}

async function appendTaskStep(
  context: PostgresTaskStoreContext,
  input: TaskAppendStepInput,
): Promise<TaskStepRecord | null> {
  const result = await context.client.query<TaskStepRow>(`
    insert into ${context.names.stepsQualified} (
      task_id,
      attempt,
      kind,
      level,
      message,
      meta,
      percent,
      created_at
    )
    select id, $4, $5, $6, $7, $8::jsonb, $9, $10::timestamptz
    from ${context.names.tasksQualified}
    where id = $1
      and lease_owner = $2
      and lease_token = $3
    returning
      id::text as id,
      task_id,
      attempt,
      kind,
      level,
      message,
      meta,
      percent,
      created_at
  `, [
    input.taskId,
    input.runnerId,
    input.leaseToken,
    input.attempt,
    input.kind ?? "step",
    input.level ?? "info",
    input.message || input.label || "step",
    JSON.stringify(input.meta ?? null),
    clampPercent(input.percent ?? input.progressPercent),
    nowIso(input.createdAt),
  ]);
  return result.rows[0] ? mapStepRow(result.rows[0]) : null;
}

async function updateTaskProgress<TInput = unknown, TResult = unknown>(
  context: PostgresTaskStoreContext,
  input: TaskUpdateProgressInput,
): Promise<TaskRecord<TInput, TResult> | null> {
  const result = await context.client.query<TaskRow>(`
    update ${context.names.tasksQualified}
    set
      progress_percent = coalesce($4, progress_percent),
      progress_label = case when $5::text is null then progress_label else $5::text end,
      progress_meta = case when $6::jsonb is null then progress_meta else $6::jsonb end,
      updated_at = $7::timestamptz,
      stale_at = null,
      stale_reason = null
    where id = $1
      and lease_owner = $2
      and lease_token = $3
      and status in ('claimed', 'running')
    returning *
  `, [
    input.taskId,
    input.runnerId,
    input.leaseToken,
    clampPercent(input.percent),
    input.label ?? null,
    input.meta == null ? null : JSON.stringify(input.meta),
    nowIso(input.updatedAt),
  ]);
  return (result.rows[0] ? mapTaskRow(result.rows[0]) : null) as TaskRecord<TInput, TResult> | null;
}

async function markTaskSucceeded<TInput = unknown, TResult = unknown>(
  context: PostgresTaskStoreContext,
  input: TaskSuccessInput<TResult>,
): Promise<TaskRecord<TInput, TResult> | null> {
  const result = await context.client.query<TaskRow>(`
    update ${context.names.tasksQualified}
    set
      status = 'succeeded',
      output = $4::jsonb,
      error = null,
      progress_percent = 100,
      finished_at = $5::timestamptz,
      updated_at = $5::timestamptz,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null,
      retry_scheduled_at = null,
      stale_at = null,
      stale_reason = null
    where id = $1
      and lease_owner = $2
      and lease_token = $3
      and status in ('claimed', 'running')
    returning *
  `, [input.taskId, input.runnerId, input.leaseToken, JSON.stringify(input.output ?? null), nowIso(input.finishedAt)]);
  return (result.rows[0] ? mapTaskRow(result.rows[0]) : null) as TaskRecord<TInput, TResult> | null;
}

export {
  appendTaskStep,
  markTaskRunning,
  markTaskSucceeded,
  renewTaskLease,
  updateTaskProgress,
};
