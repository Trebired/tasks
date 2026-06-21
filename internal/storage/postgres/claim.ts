import type {
  TaskClaimNextOptions,
  TaskRecord,
} from "#2kjvrax0gr4m";
import { nowIso } from "#qysd2ddsh0x8";
import type { PostgresTaskStoreContext, TaskRow } from "./shared.js";
import { mapTaskRow, taskToken, withTransaction } from "./shared.js";

async function claimNextTask<TInput = unknown, TResult = unknown>(
  context: PostgresTaskStoreContext,
  input: TaskClaimNextOptions,
): Promise<TaskRecord<TInput, TResult> | null> {
  if (!input.kinds.length) {
    return null;
  }

  return withTransaction(context.client, async (tx) => {
    await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`${context.names.schema}.${context.names.tasksTable}.claim`]);
    if (await reachedGlobalConcurrency(tx, context, input.globalConcurrency)) {
      return null;
    }

    const busyKeySet = await readBusyKeySet(tx, context);
    const kindCountCache = new Map<string, number>();
    const queued = await selectQueuedCandidates(tx, context, input);

    for (const row of queued.rows) {
      if (await isRowBlocked(tx, context, input, row, busyKeySet, kindCountCache)) {
        continue;
      }

      const claimed = await claimQueuedRow(tx, context, input, row);
      if (claimed) {
        return claimed as TaskRecord<TInput, TResult>;
      }
    }

    return null;
  });
}

async function reachedGlobalConcurrency(
  tx: Awaited<ReturnType<PostgresTaskStoreContext["client"]["connect"]>>,
  context: PostgresTaskStoreContext,
  limit?: number | null,
): Promise<boolean> {
  if (!limit || limit <= 0) {
    return false;
  }

  const count = await tx.query<{ count: string }>(`
    select count(*)::text as count
    from ${context.names.tasksQualified}
    where status in ('claimed', 'running')
  `);
  return Number(count.rows[0]?.count || "0") >= limit;
}

async function readBusyKeySet(
  tx: Awaited<ReturnType<PostgresTaskStoreContext["client"]["connect"]>>,
  context: PostgresTaskStoreContext,
): Promise<Set<string>> {
  const busyKeys = await tx.query<{ concurrency_key: string }>(`
    select distinct concurrency_key
    from ${context.names.tasksQualified}
    where status in ('claimed', 'running')
      and concurrency_key is not null
  `);
  return new Set(busyKeys.rows.map((row) => row.concurrency_key));
}

async function selectQueuedCandidates(
  tx: Awaited<ReturnType<PostgresTaskStoreContext["client"]["connect"]>>,
  context: PostgresTaskStoreContext,
  input: TaskClaimNextOptions,
) {
  return tx.query<TaskRow>(`
    select *
    from ${context.names.tasksQualified}
    where status = 'queued'
      and kind = any($1::text[])
      and scheduled_at <= $2::timestamptz
    order by scheduled_at asc, created_at asc
    limit $3
    for update skip locked
  `, [input.kinds, nowIso(input.now), Math.max(1, input.candidateLimit ?? 100)]);
}

async function isRowBlocked(
  tx: Awaited<ReturnType<PostgresTaskStoreContext["client"]["connect"]>>,
  context: PostgresTaskStoreContext,
  input: TaskClaimNextOptions,
  row: TaskRow,
  busyKeySet: Set<string>,
  kindCountCache: Map<string, number>,
): Promise<boolean> {
  if (row.concurrency_key && busyKeySet.has(row.concurrency_key)) {
    return true;
  }

  return reachedKindConcurrency(tx, context, input, row.kind, kindCountCache);
}

async function reachedKindConcurrency(
  tx: Awaited<ReturnType<PostgresTaskStoreContext["client"]["connect"]>>,
  context: PostgresTaskStoreContext,
  input: TaskClaimNextOptions,
  kind: string,
  cache: Map<string, number>,
): Promise<boolean> {
  const limit = input.perKindConcurrency?.[kind];
  if (!limit || limit <= 0) {
    return false;
  }

  let count = cache.get(kind);
  if (count == null) {
    count = await countRunningKind(tx, context, kind);
    cache.set(kind, count);
  }

  return count >= limit;
}

async function countRunningKind(
  tx: Awaited<ReturnType<PostgresTaskStoreContext["client"]["connect"]>>,
  context: PostgresTaskStoreContext,
  kind: string,
): Promise<number> {
  const result = await tx.query<{ count: string }>(`
    select count(*)::text as count
    from ${context.names.tasksQualified}
    where status in ('claimed', 'running')
      and kind = $1
  `, [kind]);
  return Number(result.rows[0]?.count || "0");
}

async function claimQueuedRow(
  tx: Awaited<ReturnType<PostgresTaskStoreContext["client"]["connect"]>>,
  context: PostgresTaskStoreContext,
  input: TaskClaimNextOptions,
  row: TaskRow,
): Promise<TaskRecord | null> {
  const current = nowIso(input.now);
  const updated = await tx.query<TaskRow>(`
    update ${context.names.tasksQualified}
    set
      status = 'claimed',
      attempt = attempt + 1,
      claimed_at = $2::timestamptz,
      updated_at = $2::timestamptz,
      lease_owner = $3,
      lease_token = $4,
      lease_expires_at = $5::timestamptz,
      last_heartbeat_at = $2::timestamptz,
      stale_at = null,
      stale_reason = null
    where id = $1
      and status = 'queued'
    returning *
  `, [
    row.id,
    current,
    input.runnerId,
    taskToken(),
    nowIso(Date.parse(current) + input.leaseMs),
  ]);

  return updated.rows[0] ? mapTaskRow(updated.rows[0]) : null;
}

export {
  claimNextTask,
};
