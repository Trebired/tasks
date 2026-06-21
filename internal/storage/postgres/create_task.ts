import type {
  TaskCreateInput,
  TaskCreateResult,
} from "#2kjvrax0gr4m";
import { nowIso, toErrorShape } from "#qysd2ddsh0x8";
import { normalizeTaskChannels } from "#xx6ozac2scdj";
import type { PostgresTaskStoreContext, TaskRow } from "./shared.js";
import { mapTaskRow, withTransaction } from "./shared.js";

async function createTask(context: PostgresTaskStoreContext, input: TaskCreateInput): Promise<TaskCreateResult> {
  return withTransaction(context.client, async (tx) => {
    const existing = await findExistingTask(tx, context, input);
    if (existing) {
      return existing;
    }

    const supersededTaskIds = await supersedeTasks(tx, context, input);
    const task = await insertTask(tx, context, input);

    return {
      task,
      deduplicated: false,
      disposition: supersededTaskIds.length ? "superseded" : "created",
      reusedTaskId: null,
      supersededTaskIds,
    };
  });
}

async function findExistingTask(
  tx: Awaited<ReturnType<PostgresTaskStoreContext["client"]["connect"]>>,
  context: PostgresTaskStoreContext,
  input: TaskCreateInput,
): Promise<TaskCreateResult | null> {
  if (!input.dedupeKey) {
    return null;
  }

  const existing = await tx.query<TaskRow>(`
    select *
    from ${context.names.tasksQualified}
    where kind = $1
      and dedupe_key = $2
      and status in ('queued', 'claimed', 'running')
    order by created_at desc
    limit 1
    for update
  `, [input.kind, input.dedupeKey]);

  if (!existing.rows[0]) {
    return null;
  }

  return {
    task: mapTaskRow(existing.rows[0]),
    deduplicated: true,
    disposition: "reused",
    reusedTaskId: existing.rows[0].id,
    supersededTaskIds: [],
  };
}

async function supersedeTasks(
  tx: Awaited<ReturnType<PostgresTaskStoreContext["client"]["connect"]>>,
  context: PostgresTaskStoreContext,
  input: TaskCreateInput,
): Promise<string[]> {
  if (!input.supersedeExisting || !input.supersedeKey) {
    return [];
  }

  const superseded = await tx.query<{ id: string }>(`
    update ${context.names.tasksQualified}
    set
      status = 'cancelled',
      error = $3::jsonb,
      cancel_requested_at = $4::timestamptz,
      finished_at = $4::timestamptz,
      updated_at = $4::timestamptz,
      lease_owner = null,
      lease_token = null,
      lease_expires_at = null
    where kind = $1
      and supersede_key = $2
      and status in ('queued', 'claimed', 'running')
    returning id
  `, [
    input.kind,
    input.supersedeKey,
    JSON.stringify(toErrorShape({
      message: "Task superseded by a newer task",
      code: "TASK_SUPERSEDED",
    })),
    nowIso(),
  ]);

  return superseded.rows.map((row) => row.id);
}

async function insertTask(
  tx: Awaited<ReturnType<PostgresTaskStoreContext["client"]["connect"]>>,
  context: PostgresTaskStoreContext,
  input: TaskCreateInput,
) {
  const createdAt = nowIso();
  const inserted = await tx.query<TaskRow>(`
    insert into ${context.names.tasksQualified} (
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
    values ($1, $2, 'queued', $3::jsonb, $4::jsonb, $5, $6, $7, $8::jsonb, 0, $9, $10::timestamptz, $11::timestamptz, $11::timestamptz)
    returning *
  `, [
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
  ]);

  if (!inserted.rows[0]) {
    throw new Error(`Unable to create task ${input.id}`);
  }

  return mapTaskRow(inserted.rows[0]);
}

export {
  createTask,
};
