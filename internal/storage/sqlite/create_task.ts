import type {
  TaskCreateInput,
  TaskCreateResult,
} from "#2kjvrax0gr4m";
import { nowIso, toErrorShape } from "#qysd2ddsh0x8";
import { normalizeTaskChannels } from "#xx6ozac2scdj";
import type { SqliteTaskRow, SqliteTaskStoreContext } from "./shared.js";
import {
  executeAll,
  executeGet,
  executeRun,
  mapSqliteTaskRow,
  withSqliteTransaction,
} from "./shared.js";

async function createTask(context: SqliteTaskStoreContext, input: TaskCreateInput): Promise<TaskCreateResult> {
  return withSqliteTransaction(context.db, () => {
    const existing = findExistingTask(context, input);
    if (existing) {
      return existing;
    }

    const supersededTaskIds = supersedeTasks(context, input);
    const task = insertTask(context, input);

    return {
      task,
      deduplicated: false,
      disposition: supersededTaskIds.length ? "superseded" : "created",
      reusedTaskId: null,
      supersededTaskIds,
    };
  });
}

function findExistingTask(context: SqliteTaskStoreContext, input: TaskCreateInput): TaskCreateResult | null {
  if (!input.dedupeKey) {
    return null;
  }

  const row = executeGet<SqliteTaskRow>(
    context.db,
    `
      select *
      from "${context.names.tasksTable}"
      where kind = ?
        and dedupe_key = ?
        and status in ('queued', 'claimed', 'running')
      order by created_at desc
      limit 1
    `,
    [input.kind, input.dedupeKey],
  );

  if (!row) {
    return null;
  }

  return {
    task: mapSqliteTaskRow(row),
    deduplicated: true,
    disposition: "reused",
    reusedTaskId: row.id,
    supersededTaskIds: [],
  };
}

function supersedeTasks(context: SqliteTaskStoreContext, input: TaskCreateInput): string[] {
  if (!input.supersedeExisting || !input.supersedeKey) {
    return [];
  }

  const rows = executeAll<{ id: string }>(
    context.db,
    `
      update "${context.names.tasksTable}"
      set
        status = 'cancelled',
        error = ?,
        cancel_requested_at = ?,
        finished_at = ?,
        updated_at = ?,
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null
      where kind = ?
        and supersede_key = ?
        and status in ('queued', 'claimed', 'running')
      returning id
    `,
    [
      JSON.stringify(toErrorShape({
        message: "Task superseded by a newer task",
        code: "TASK_SUPERSEDED",
      })),
      nowIso(),
      nowIso(),
      nowIso(),
      input.kind,
      input.supersedeKey,
    ],
  );

  return rows.map((row) => row.id);
}

function insertTask(context: SqliteTaskStoreContext, input: TaskCreateInput) {
  const createdAt = nowIso();
  const values = createInsertTaskValues(input, createdAt);

  executeRun(
    context.db,
    `
      insert into "${context.names.tasksTable}" (
        id,
        kind,
        status,
        input,
        metadata,
        concurrency_key,
        dedupe_key,
        supersede_key,
        channels,
        attempt,
        max_attempts,
        scheduled_at,
        created_at,
        updated_at
      )
      values (?, ?, 'queued', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    `,
    values,
  );

  const row = executeGet<SqliteTaskRow>(
    context.db,
    `select * from "${context.names.tasksTable}" where id = ? limit 1`,
    [input.id],
  );

  if (!row) {
    throw new Error(`Unable to create task ${input.id}`);
  }

  return mapSqliteTaskRow(row);
}

function createInsertTaskValues(input: TaskCreateInput, createdAt: string): unknown[] {
  return [
    input.id,
    input.kind,
    JSON.stringify(input.input ?? null),
    JSON.stringify(input.metadata ?? {}),
    input.concurrencyKey ?? null,
    input.dedupeKey ?? null,
    input.supersedeKey ?? null,
    JSON.stringify(normalizeTaskChannels(input.channels)),
    input.maxAttempts,
    nowIso(input.scheduledAt),
    createdAt,
    createdAt,
  ];
}

export {
  createTask,
};
