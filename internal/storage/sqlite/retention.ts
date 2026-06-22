import type {
  TaskRetentionPolicy,
  TaskRetentionResult,
} from "#2kjvrax0gr4m";
import { nowIso } from "#qysd2ddsh0x8";
import type { SqliteTaskStoreContext } from "./shared.js";
import { executeAll, executeRun } from "./shared.js";

async function applyRetentionPolicy(
  context: SqliteTaskStoreContext,
  policy: TaskRetentionPolicy,
): Promise<TaskRetentionResult> {
  const deletedSteps = trimTaskSteps(context, policy.stepLimitPerTask);
  const ttlDeletedTasks = deleteTasksByTtl(context, policy);
  const latestDeletedTasks = deleteNonLatestTasks(context, policy);

  return {
    deletedTasks: ttlDeletedTasks + latestDeletedTasks,
    deletedSteps: deletedSteps.deletedSteps,
    compactedTasks: deletedSteps.compactedTasks,
  };
}

function trimTaskSteps(context: SqliteTaskStoreContext, stepLimitPerTask?: number): {
  compactedTasks: number;
  deletedSteps: number;
} {
  if (!stepLimitPerTask || stepLimitPerTask <= 0) {
    return {
      compactedTasks: 0,
      deletedSteps: 0,
    };
  }

  const rows = executeAll<{ id: number; task_id: string }>(
    context.db,
    `
      select id, task_id
      from (
        select
          id,
          task_id,
          row_number() over (partition by task_id order by id desc) as rn
        from "${context.names.stepsTable}"
      )
      where rn > ?
    `,
    [stepLimitPerTask],
  );

  for (const row of rows) {
    executeRun(
      context.db,
      `delete from "${context.names.stepsTable}" where id = ?`,
      [row.id],
    );
  }

  return {
    deletedSteps: rows.length,
    compactedTasks: new Set(rows.map((row) => row.task_id)).size,
  };
}

function deleteTasksByTtl(context: SqliteTaskStoreContext, policy: TaskRetentionPolicy): number {
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
    const rows = executeAll<{ id: string }>(
      context.db,
      `
        select id
        from "${context.names.tasksTable}"
        where status = ?
          and finished_at is not null
          and finished_at < ?
      `,
      [status, cutoff],
    );

    for (const row of rows) {
      executeRun(
        context.db,
        `delete from "${context.names.tasksTable}" where id = ?`,
        [row.id],
      );
    }

    deletedTasks += rows.length;
  }

  return deletedTasks;
}

function deleteNonLatestTasks(context: SqliteTaskStoreContext, policy: TaskRetentionPolicy): number {
  return deleteRankedTasks(context, "succeeded", policy.keepLatestSuccessesPerKind)
    + deleteRankedTasks(context, "failed", policy.keepLatestFailuresPerKind);
}

function deleteRankedTasks(
  context: SqliteTaskStoreContext,
  status: "failed" | "succeeded",
  limit?: number,
): number {
  if (!limit || limit <= 0) {
    return 0;
  }

  const rows = executeAll<{ id: string }>(
    context.db,
    `
      select id
      from (
        select
          id,
          row_number() over (partition by kind order by finished_at desc, created_at desc) as rn
        from "${context.names.tasksTable}"
        where status = ?
      )
      where rn > ?
    `,
    [status, limit],
  );

  for (const row of rows) {
    executeRun(
      context.db,
      `delete from "${context.names.tasksTable}" where id = ?`,
      [row.id],
    );
  }

  return rows.length;
}

export {
  applyRetentionPolicy,
};
