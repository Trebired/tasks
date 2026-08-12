import type { TaskListQuery } from "#2kjvrax0gr4m";

type TaskQueryDialect = "postgres" | "sqlite";

type TaskWhereClause = {
  params: unknown[];
  sql: string;
};

function createTaskWhereClauseBuilder(dialect: TaskQueryDialect) {
  return (query: TaskListQuery = {}): TaskWhereClause => buildTaskWhereClause(dialect, query);
}

function buildTaskWhereClause(dialect: TaskQueryDialect, query: TaskListQuery): TaskWhereClause {
  const where: string[] = [];
  const params: unknown[] = [];

  pushArrayFilter(dialect, where, params, "id", query.taskIds);
  pushArrayFilter(dialect, where, params, "kind", query.kinds);
  pushArrayFilter(dialect, where, params, "status", query.statuses);
  pushChannelFilter(dialect, where, params, query.channels);
  pushValueFilter(dialect, where, params, "concurrency_key", query.concurrencyKey);
  pushValueFilter(dialect, where, params, "dedupe_key", query.dedupeKey);
  pushValueFilter(dialect, where, params, "supersede_key", query.supersedeKey);

  return {
    params,
    sql: where.length ? `where ${where.join(" and ")}` : "",
  };
}

function normalizeTaskOrder(orderBy?: TaskListQuery["orderBy"]): string {
  switch (orderBy) {
    case "created_asc":
    return "created_at asc";
    case "scheduled_asc":
    return "scheduled_at asc, created_at asc";
    case "scheduled_desc":
    return "scheduled_at desc, created_at desc";
    case "updated_desc":
    return "updated_at desc";
    case "created_desc":
    default:
    return "created_at desc";
  }
}

function pushArrayFilter(
  dialect: TaskQueryDialect,
  where: string[],
  params: unknown[],
  field: string,
  values?: string[] | null,
): void {
  if (!values?.length) {
    return;
  }

  if (dialect === "postgres") {
    params.push(values);
    where.push(`${field} = any($${params.length}::text[])`);
    return;
  }

  const placeholders = values.map(() => "?").join(", ");
  params.push(...values);
  where.push(`${field} in (${placeholders})`);
}

function pushValueFilter(
  dialect: TaskQueryDialect,
  where: string[],
  params: unknown[],
  field: string,
  value?: string | null,
): void {
  if (!value) {
    return;
  }

  params.push(value);
  where.push(dialect === "postgres" ? `${field} = $${params.length}` : `${field} = ?`);
}

function pushChannelFilter(
  dialect: TaskQueryDialect,
  where: string[],
  params: unknown[],
  channels?: string[] | null,
): void {
  if (!channels?.length) {
    return;
  }

  if (dialect === "postgres") {
    params.push(channels);
    where.push(`exists (
      select 1
      from jsonb_array_elements_text(channels) as channel(value)
      where channel.value = any($${params.length}::text[])
    )`);
    return;
  }

  const placeholders = channels.map(() => "?").join(", ");
  params.push(...channels);
  where.push(`exists (
    select 1
    from json_each(channels)
    where json_each.value in (${placeholders})
  )`);
}

export {
  createTaskWhereClauseBuilder,
  normalizeTaskOrder,
};
