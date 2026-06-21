import type { TaskListQuery } from "#2kjvrax0gr4m";

function buildWhereClause(query: TaskListQuery = {}): {
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

function normalizeOrder(orderBy?: TaskListQuery["orderBy"]): string {
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

  params.push(values);
  where.push(`${field} = any($${params.length}::text[])`);
}

function pushValueFilter(where: string[], params: unknown[], field: string, value?: string | null): void {
  if (!value) {
    return;
  }

  params.push(value);
  where.push(`${field} = $${params.length}`);
}

function pushChannelFilter(where: string[], params: unknown[], channels?: string[] | null): void {
  if (!channels?.length) {
    return;
  }

  params.push(channels);
  where.push(`exists (
    select 1
    from jsonb_array_elements_text(channels) as channel(value)
    where channel.value = any($${params.length}::text[])
  )`);
}

export {
  buildWhereClause,
  normalizeOrder,
};
