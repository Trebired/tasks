import type {
  TaskClaimNextOptions,
  TaskRecord,
} from "#2kjvrax0gr4m";
import { nowIso } from "#qysd2ddsh0x8";
import type { SqliteTaskRow, SqliteTaskStoreContext } from "./shared.js";
import {
  executeAll,
  executeGet,
  executeRun,
  mapSqliteTaskRow,
  sqliteTaskToken,
  withSqliteTransaction,
} from "./shared.js";

async function claimNextTask<TInput = unknown, TResult = unknown>(
  context: SqliteTaskStoreContext,
  input: TaskClaimNextOptions,
): Promise<TaskRecord<TInput, TResult> | null> {
  if (!input.kinds.length) {
    return null;
  }

  return withSqliteTransaction(context.db, () => {
    if (reachedGlobalConcurrency(context, input.globalConcurrency)) {
      return null;
    }

    const busyKeys = readBusyKeySet(context);
    const kindCounts = new Map<string, number>();
    const queued = selectQueuedCandidates(context, input);

    for (const row of queued) {
      if (row.concurrency_key && busyKeys.has(row.concurrency_key)) {
        continue;
      }

      if (reachedKindConcurrency(context, input, row.kind, kindCounts)) {
        continue;
      }

      const claimed = claimQueuedRow(context, input, row);
      if (claimed) {
        return claimed as TaskRecord<TInput, TResult>;
      }
    }

    return null;
  });
}

function reachedGlobalConcurrency(context: SqliteTaskStoreContext, limit?: number | null): boolean {
  if (!limit || limit <= 0) {
    return false;
  }

  const row = executeGet<{ count: number }>(
    context.db,
    `
      select count(*) as count
      from "${context.names.tasksTable}"
      where status in ('claimed', 'running')
    `,
  );

  return Number(row?.count || 0) >= limit;
}

function readBusyKeySet(context: SqliteTaskStoreContext): Set<string> {
  const rows = executeAll<{ concurrency_key: string }>(
    context.db,
    `
      select distinct concurrency_key
      from "${context.names.tasksTable}"
      where status in ('claimed', 'running')
        and concurrency_key is not null
    `,
  );

  return new Set(rows.map((row) => row.concurrency_key));
}

function selectQueuedCandidates(context: SqliteTaskStoreContext, input: TaskClaimNextOptions): SqliteTaskRow[] {
  const kindPlaceholders = input.kinds.map(() => "?").join(", ");

  return executeAll<SqliteTaskRow>(
    context.db,
    `
      select *
      from "${context.names.tasksTable}"
      where status = 'queued'
        and kind in (${kindPlaceholders})
        and scheduled_at <= ?
      order by scheduled_at asc, created_at asc
      limit ?
    `,
    [...input.kinds, nowIso(input.now), Math.max(1, input.candidateLimit ?? 100)],
  );
}

function reachedKindConcurrency(
  context: SqliteTaskStoreContext,
  input: TaskClaimNextOptions,
  kind: string,
  cache: Map<string, number>,
): boolean {
  const limit = input.perKindConcurrency?.[kind];
  if (!limit || limit <= 0) {
    return false;
  }

  let count = cache.get(kind);
  if (count == null) {
    count = countRunningKind(context, kind);
    cache.set(kind, count);
  }

  return count >= limit;
}

function countRunningKind(context: SqliteTaskStoreContext, kind: string): number {
  const row = executeGet<{ count: number }>(
    context.db,
    `
      select count(*) as count
      from "${context.names.tasksTable}"
      where status in ('claimed', 'running')
        and kind = ?
    `,
    [kind],
  );

  return Number(row?.count || 0);
}

function claimQueuedRow(
  context: SqliteTaskStoreContext,
  input: TaskClaimNextOptions,
  row: SqliteTaskRow,
): TaskRecord | null {
  const current = nowIso(input.now);

  executeRun(
    context.db,
    `
      update "${context.names.tasksTable}"
      set
        status = 'claimed',
        attempt = attempt + 1,
        claimed_at = ?,
        updated_at = ?,
        lease_owner = ?,
        lease_token = ?,
        lease_expires_at = ?,
        last_heartbeat_at = ?,
        stale_at = null,
        stale_reason = null
      where id = ?
        and status = 'queued'
    `,
    [
      current,
      current,
      input.runnerId,
      sqliteTaskToken(),
      nowIso(Date.parse(current) + input.leaseMs),
      current,
      row.id,
    ],
  );

  const claimed = executeGet<SqliteTaskRow>(
    context.db,
    `select * from "${context.names.tasksTable}" where id = ? and status = 'claimed' limit 1`,
    [row.id],
  );

  return claimed ? mapSqliteTaskRow(claimed) : null;
}

export {
  claimNextTask,
};
