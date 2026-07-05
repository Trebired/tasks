import type { TaskListQuery } from "#2kjvrax0gr4m";

function buildSqliteWhereClause(query: TaskListQuery = {}): {
  params: unknown[];
  sql: string;
} {
  const where: string[] = [];
  const params: unknown[] = [];

  pushArrayFilter(where, params, "id", query.taskIds);
  pushArrayFilter(where, params, "kind", query.kinds);
  pushArrayFilter(where, params, "status", query.statuses);
  pushChannelFilter(where, params, query.channels);
  pushValueFilter(where, params, "concurrency_key", query.concurrencyKey);
  pushValueFilter(where, params, "dedupe_key", query.dedupeKey);
  pushValueFilter(where, params, "supersede_key", query.supersedeKey);

  return {
    params,
    sql: where.length ? `where ${where.join(" and ")}` : "",
  };
}

function normalizeSqliteOrder(orderBy?: TaskListQuery["orderBy"]): string {
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

function pushArrayFilter(where: string[], params: unknown[], field: string, values?: string[] | null): void {
  if (!values?.length) {
    return;
  }

  const placeholders = values.map(() => "?").join(", ");
  params.push(...values);
  where.push(`${field} in (${placeholders})`);
}

function pushValueFilter(where: string[], params: unknown[], field: string, value?: string | null): void {
  if (!value) {
    return;
  }

  params.push(value);
  where.push(`${field} = ?`);
}

function pushChannelFilter(where: string[], params: unknown[], channels?: string[] | null): void {
  if (!channels?.length) {
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
  buildSqliteWhereClause,
  normalizeSqliteOrder,
};
