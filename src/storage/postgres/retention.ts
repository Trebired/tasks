import type {
  TaskRetentionPolicy,
  TaskRetentionResult,
} from "#2kjvrax0gr4m";
import { nowIso } from "#qysd2ddsh0x8";
import type { PostgresTaskStoreContext } from "./shared.js";

async function applyRetentionPolicy(
  context: PostgresTaskStoreContext,
  policy: TaskRetentionPolicy,
): Promise<TaskRetentionResult> {
  const deletedSteps = await trimTaskSteps(context, policy.stepLimitPerTask);
  const compactedTasks = deletedSteps.compactedTasks;
  const ttlDeletedTasks = await deleteTasksByTtl(context, policy);
  const latestDeletedTasks = await deleteNonLatestTasks(context, policy);

  return {
    deletedTasks: ttlDeletedTasks + latestDeletedTasks,
    deletedSteps: deletedSteps.deletedSteps,
    compactedTasks,
  };
}

async function trimTaskSteps(context: PostgresTaskStoreContext, stepLimitPerTask?: number): Promise<{
  compactedTasks: number;
  deletedSteps: number;
}> {
  if (!stepLimitPerTask || stepLimitPerTask <= 0) {
    return {
      compactedTasks: 0,
      deletedSteps: 0,
    };
  }

  const deleted = await context.client.query<{ task_id: string }>(`
    with ranked as (
      select
        id,
        task_id,
        row_number() over (partition by task_id order by id desc) as rn
      from ${context.names.stepsQualified}
    )
    delete from ${context.names.stepsQualified}
    where id in (
      select id
      from ranked
      where rn > $1
    )
    returning task_id
  `, [stepLimitPerTask]);

  return {
    deletedSteps: Number(deleted.rowCount || 0),
    compactedTasks: new Set(deleted.rows.map((row) => row.task_id)).size,
  };
}

async function deleteTasksByTtl(context: PostgresTaskStoreContext, policy: TaskRetentionPolicy): Promise<number> {
  let deletedTasks = 0;

  for (const [status, ttlMs] of [
    ["succeeded", policy.successTtlMs],
    ["failed", policy.failedTtlMs],
    ["cancelled", policy.cancelledTtlMs],
  ] as const) {
    if (!ttlMs || ttlMs <= 0) {
      continue;
    }

    const cutoff = nowIso(Date.now() - ttlMs);
    const deleted = await context.client.query(`
      delete from ${context.names.tasksQualified}
      where status = $1
        and finished_at is not null
        and finished_at < $2::timestamptz
    `, [status, cutoff]);
    deletedTasks += Number(deleted.rowCount || 0);
  }

  return deletedTasks;
}

async function deleteNonLatestTasks(context: PostgresTaskStoreContext, policy: TaskRetentionPolicy): Promise<number> {
  const successDeleted = await deleteRankedTasks(context, "succeeded", policy.keepLatestSuccessesPerKind);
  const failureDeleted = await deleteRankedTasks(context, "failed", policy.keepLatestFailuresPerKind);
  return successDeleted + failureDeleted;
}

async function deleteRankedTasks(
  context: PostgresTaskStoreContext,
  status: "failed" | "succeeded",
  limit?: number,
): Promise<number> {
  if (!limit || limit <= 0) {
    return 0;
  }

  const deleted = await context.client.query(`
    with ranked as (
      select
        id,
        row_number() over (partition by kind order by finished_at desc nulls last, created_at desc) as rn
      from ${context.names.tasksQualified}
      where status = $2
    )
    delete from ${context.names.tasksQualified}
    where id in (
      select id
      from ranked
      where rn > $1
    )
  `, [limit, status]);

  return Number(deleted.rowCount || 0);
}

export {
  applyRetentionPolicy,
};
