import type {
  TaskAggregateSnapshot,
  TaskDedupeLookup,
  TaskListQuery,
  TaskRecord,
  TaskStepListQuery,
  TaskStepRecord,
} from "#2kjvrax0gr4m";
import { buildTaskAggregateSnapshot, createTaskSnapshot } from "#ir9grtwyf3f1";
import { buildSqliteWhereClause, normalizeSqliteOrder } from "./query.js";
import type {
  SqliteTaskRow,
  SqliteTaskStepRow,
  SqliteTaskStoreContext,
} from "./shared.js";
import {
  executeAll,
  executeGet,
  mapSqliteStepRow,
  mapSqliteTaskRow,
} from "./shared.js";

async function getTask<TInput = unknown, TResult = unknown>(
  context: SqliteTaskStoreContext,
  taskId: string,
): Promise<TaskRecord<TInput, TResult> | null> {
  const row = executeGet<SqliteTaskRow>(
    context.db,
    `select * from "${context.names.tasksTable}" where id = ? limit 1`,
    [taskId],
  );

  return (row ? mapSqliteTaskRow(row) : null) as TaskRecord<TInput, TResult> | null;
}

async function listTasks<TInput = unknown, TResult = unknown>(
  context: SqliteTaskStoreContext,
  query: TaskListQuery = {},
): Promise<TaskRecord<TInput, TResult>[]> {
  const where = buildSqliteWhereClause(query);
  const rows = executeAll<SqliteTaskRow>(
    context.db,
    `
      select *
      from "${context.names.tasksTable}"
      ${where.sql}
      order by ${normalizeSqliteOrder(query.orderBy)}
      limit ?
      offset ?
    `,
    [...where.params, Math.max(1, query.limit ?? 100), Math.max(0, query.offset ?? 0)],
  );

  return rows.map(mapSqliteTaskRow) as TaskRecord<TInput, TResult>[];
}

async function summarizeTasks(
  context: SqliteTaskStoreContext,
  query: TaskListQuery = {},
): Promise<TaskAggregateSnapshot> {
  const where = buildSqliteWhereClause(query);
  const rows = executeAll<SqliteTaskRow>(
    context.db,
    `
      select *
      from "${context.names.tasksTable}"
      ${where.sql}
    `,
    where.params,
  );

  return buildTaskAggregateSnapshot(rows.map((row) => createTaskSnapshot(mapSqliteTaskRow(row))));
}

async function listTaskSteps(
  context: SqliteTaskStoreContext,
  taskId: string,
  query: TaskStepListQuery = {},
): Promise<TaskStepRecord[]> {
  const rows = executeAll<SqliteTaskStepRow>(
    context.db,
    `
      select *
      from "${context.names.stepsTable}"
      where task_id = ?
      order by id asc
      limit ?
      offset ?
    `,
    [taskId, Math.max(1, query.limit ?? 200), Math.max(0, query.offset ?? 0)],
  );

  return rows.map(mapSqliteStepRow);
}

async function findTaskByDedupeKey<TInput = unknown, TResult = unknown>(
  context: SqliteTaskStoreContext,
  input: TaskDedupeLookup,
): Promise<TaskRecord<TInput, TResult> | null> {
  const row = executeGet<SqliteTaskRow>(
    context.db,
    `
      select *
      from "${context.names.tasksTable}"
      where kind = ?
        and dedupe_key = ?
        ${input.openOnly === false ? "" : "and status in ('queued', 'claimed', 'running')"}
      order by created_at desc
      limit 1
    `,
    [input.kind, input.dedupeKey],
  );

  return (row ? mapSqliteTaskRow(row) : null) as TaskRecord<TInput, TResult> | null;
}

export {
  findTaskByDedupeKey,
  getTask,
  listTaskSteps,
  listTasks,
  summarizeTasks,
};
