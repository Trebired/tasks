import type {
  TaskAggregateSnapshot,
  TaskDedupeLookup,
  TaskListQuery,
  TaskRecord,
  TaskStepListQuery,
  TaskStepRecord,
} from "#2kjvrax0gr4m";
import { buildTaskAggregateSnapshot, createTaskSnapshot } from "#ir9grtwyf3f1";
import { buildWhereClause, normalizeOrder } from "./query.js";
import type { PostgresTaskStoreContext, TaskRow, TaskStepRow } from "./shared.js";
import { mapStepRow, mapTaskRow } from "./shared.js";

async function getTask<TInput = unknown, TResult = unknown>(
  context: PostgresTaskStoreContext,
  taskId: string,
): Promise<TaskRecord<TInput, TResult> | null> {
  const result = await context.client.query<TaskRow>(`select * from ${context.names.tasksQualified} where id = $1 limit 1`, [taskId]);
  return (result.rows[0] ? mapTaskRow(result.rows[0]) : null) as TaskRecord<TInput, TResult> | null;
}

async function listTasks<TInput = unknown, TResult = unknown>(
  context: PostgresTaskStoreContext,
  query: TaskListQuery = {},
): Promise<TaskRecord<TInput, TResult>[]> {
  const where = buildWhereClause(query);
  const params = [...where.params, Math.max(1, query.limit ?? 100), Math.max(0, query.offset ?? 0)];
  const limitParam = params.length - 1;
  const offsetParam = params.length;
  const result = await context.client.query<TaskRow>(`
    select *
    from ${context.names.tasksQualified}
    ${where.sql}
    order by ${normalizeOrder(query.orderBy)}
    limit $${limitParam}
    offset $${offsetParam}
  `, params);
  return result.rows.map(mapTaskRow) as TaskRecord<TInput, TResult>[];
}

async function summarizeTasks(context: PostgresTaskStoreContext, query: TaskListQuery = {}): Promise<TaskAggregateSnapshot> {
  const where = buildWhereClause(query);
  const rows = await context.client.query<TaskRow>(`
    select *
    from ${context.names.tasksQualified}
    ${where.sql}
  `, where.params);
  return buildTaskAggregateSnapshot(rows.rows.map((row) => createTaskSnapshot(mapTaskRow(row))));
}

async function listTaskSteps(
  context: PostgresTaskStoreContext,
  taskId: string,
  query: TaskStepListQuery = {},
): Promise<TaskStepRecord[]> {
  const result = await context.client.query<TaskStepRow>(`
    select
      id::text as id,
      task_id,
      attempt,
      kind,
      level,
      message,
      meta,
      percent,
      created_at
    from ${context.names.stepsQualified}
    where task_id = $1
    order by id asc
    limit $2
    offset $3
  `, [taskId, Math.max(1, query.limit ?? 200), Math.max(0, query.offset ?? 0)]);
  return result.rows.map(mapStepRow);
}

async function findTaskByDedupeKey<TInput = unknown, TResult = unknown>(
  context: PostgresTaskStoreContext,
  input: TaskDedupeLookup,
): Promise<TaskRecord<TInput, TResult> | null> {
  const statuses = input.openOnly === false ? null : ["queued", "claimed", "running"];
  const result = await context.client.query<TaskRow>(`
    select *
    from ${context.names.tasksQualified}
    where kind = $1
      and dedupe_key = $2
      ${statuses ? "and status = any($3::text[])" : ""}
    order by created_at desc
    limit 1
  `, statuses ? [input.kind, input.dedupeKey, statuses] : [input.kind, input.dedupeKey]);
  return (result.rows[0] ? mapTaskRow(result.rows[0]) : null) as TaskRecord<TInput, TResult> | null;
}

export {
  findTaskByDedupeKey,
  getTask,
  listTaskSteps,
  listTasks,
  summarizeTasks,
};
