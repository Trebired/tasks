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
import type {
  SqliteTaskRow,
  SqliteTaskStepRow,
  SqliteTaskStoreContext,
} from "./shared.js";
import {
  executeGet,
  executeRun,
  mapSqliteStepRow,
  mapSqliteTaskRow,
  readSqliteChanges,
} from "./shared.js";

async function markTaskRunning<TInput = unknown, TResult = unknown>(
  context: SqliteTaskStoreContext,
  input: TaskLeaseInput,
): Promise<TaskRecord<TInput, TResult> | null> {
  const updated = executeRun(
    context.db,
    `
      update "${context.names.tasksTable}"
      set
        status = 'running',
        started_at = coalesce(started_at, ?),
        updated_at = ?,
        stale_at = null,
        stale_reason = null
      where id = ?
        and lease_owner = ?
        and lease_token = ?
        and status in ('claimed', 'running')
    `,
    [nowIso(), nowIso(), input.taskId, input.runnerId, input.leaseToken],
  );

  if (!readSqliteChanges(updated)) {
    return null;
  }

  const row = executeGet<SqliteTaskRow>(
    context.db,
    `select * from "${context.names.tasksTable}" where id = ? limit 1`,
    [input.taskId],
  );

  return (row ? mapSqliteTaskRow(row) : null) as TaskRecord<TInput, TResult> | null;
}

async function renewTaskLease<TInput = unknown, TResult = unknown>(
  context: SqliteTaskStoreContext,
  input: TaskLeaseRenewalInput,
): Promise<TaskRecord<TInput, TResult> | null> {
  const current = nowIso(input.now);

  const updated = executeRun(
    context.db,
    `
      update "${context.names.tasksTable}"
      set
        lease_expires_at = ?,
        last_heartbeat_at = ?,
        updated_at = ?,
        stale_at = null,
        stale_reason = null
      where id = ?
        and lease_owner = ?
        and lease_token = ?
        and status in ('claimed', 'running')
    `,
    [
      nowIso(Date.parse(current) + input.leaseMs),
      current,
      current,
      input.taskId,
      input.runnerId,
      input.leaseToken,
    ],
  );

  if (!readSqliteChanges(updated)) {
    return null;
  }

  const row = executeGet<SqliteTaskRow>(
    context.db,
    `select * from "${context.names.tasksTable}" where id = ? limit 1`,
    [input.taskId],
  );

  return (row ? mapSqliteTaskRow(row) : null) as TaskRecord<TInput, TResult> | null;
}

async function appendTaskStep(
  context: SqliteTaskStoreContext,
  input: TaskAppendStepInput,
): Promise<TaskStepRecord | null> {
  if (!canAppendTaskStep(context, input)) {
    return null;
  }

  const inserted = executeRun(
    context.db,
    `
      insert into "${context.names.stepsTable}" (
        task_id,
        attempt,
        kind,
        level,
        message,
        meta,
        percent,
        created_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      ...createStepInsertValues(input),
    ],
  );

  if (!readSqliteChanges(inserted)) {
    return null;
  }

  const row = executeGet<SqliteTaskStepRow>(
    context.db,
    `
      select *
      from "${context.names.stepsTable}"
      where task_id = ?
      order by id desc
      limit 1
    `,
    [input.taskId],
  );

  return row ? mapSqliteStepRow(row) : null;
}

function canAppendTaskStep(context: SqliteTaskStoreContext, input: TaskAppendStepInput): boolean {
  return Boolean(executeGet<SqliteTaskRow>(
    context.db,
    `
      select *
      from "${context.names.tasksTable}"
      where id = ?
        and lease_owner = ?
        and lease_token = ?
      limit 1
    `,
    [input.taskId, input.runnerId, input.leaseToken],
  ));
}

function createStepInsertValues(input: TaskAppendStepInput): unknown[] {
  return [
    input.taskId,
    input.attempt,
    input.kind ?? "step",
    input.level ?? "info",
    input.message || input.label || "step",
    JSON.stringify(input.meta ?? null),
    clampPercent(input.percent ?? input.progressPercent),
    nowIso(input.createdAt),
  ];
}

async function updateTaskProgress<TInput = unknown, TResult = unknown>(
  context: SqliteTaskStoreContext,
  input: TaskUpdateProgressInput,
): Promise<TaskRecord<TInput, TResult> | null> {
  const current = nowIso(input.updatedAt);

  const updated = executeRun(
    context.db,
    `
      update "${context.names.tasksTable}"
      set
        progress_percent = coalesce(?, progress_percent),
        progress_label = case when ? is null then progress_label else ? end,
        progress_meta = case when ? is null then progress_meta else ? end,
        updated_at = ?,
        stale_at = null,
        stale_reason = null
      where id = ?
        and lease_owner = ?
        and lease_token = ?
        and status in ('claimed', 'running')
    `,
    [
      clampPercent(input.percent),
      input.label ?? null,
      input.label ?? null,
      input.meta == null ? null : JSON.stringify(input.meta),
      input.meta == null ? null : JSON.stringify(input.meta),
      current,
      input.taskId,
      input.runnerId,
      input.leaseToken,
    ],
  );

  if (!readSqliteChanges(updated)) {
    return null;
  }

  const row = executeGet<SqliteTaskRow>(
    context.db,
    `select * from "${context.names.tasksTable}" where id = ? limit 1`,
    [input.taskId],
  );

  return (row ? mapSqliteTaskRow(row) : null) as TaskRecord<TInput, TResult> | null;
}

async function markTaskSucceeded<TInput = unknown, TResult = unknown>(
  context: SqliteTaskStoreContext,
  input: TaskSuccessInput<TResult>,
): Promise<TaskRecord<TInput, TResult> | null> {
  const current = nowIso(input.finishedAt);

  const updated = executeRun(
    context.db,
    `
      update "${context.names.tasksTable}"
      set
        status = 'succeeded',
        output = ?,
        error = null,
        progress_percent = 100,
        finished_at = ?,
        updated_at = ?,
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null,
        retry_scheduled_at = null,
        stale_at = null,
        stale_reason = null
      where id = ?
        and lease_owner = ?
        and lease_token = ?
        and status in ('claimed', 'running')
    `,
    [
      JSON.stringify(input.output ?? null),
      current,
      current,
      input.taskId,
      input.runnerId,
      input.leaseToken,
    ],
  );

  if (!readSqliteChanges(updated)) {
    return null;
  }

  const row = executeGet<SqliteTaskRow>(
    context.db,
    `select * from "${context.names.tasksTable}" where id = ? limit 1`,
    [input.taskId],
  );

  return (row ? mapSqliteTaskRow(row) : null) as TaskRecord<TInput, TResult> | null;
}

export {
  appendTaskStep,
  markTaskRunning,
  markTaskSucceeded,
  renewTaskLease,
  updateTaskProgress,
};
