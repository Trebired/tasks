import type {
  PostgresTaskPoolClient,
  PostgresTaskSchemaOptions,
  PostgresTaskStoreOptions,
  TaskRecord,
  TaskStatus,
  TaskStepRecord,
  TaskTerminalError,
} from "#2kjvrax0gr4m";
import { nowIso, parseJsonValue } from "#qysd2ddsh0x8";
import { normalizeTaskChannels } from "#xx6ozac2scdj";

export type TaskRow = {
  id: string;
  kind: string;
  status: TaskStatus;
  input: unknown;
  output: unknown;
  error: unknown;
  metadata: unknown;
  progress_percent: number | null;
  progress_label: string | null;
  progress_meta: unknown;
  concurrency_key: string | null;
  dedupe_key: string | null;
  supersede_key: string | null;
  channels: unknown;
  attempt: number;
  max_attempts: number;
  scheduled_at: string;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  cancel_requested_at: string | null;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  last_heartbeat_at: string | null;
  retry_scheduled_at: string | null;
  stale_at: string | null;
  stale_reason: string | null;
};

export type TaskStepRow = {
  id: string;
  task_id: string;
  attempt: number;
  kind: string;
  level: string;
  message: string;
  meta: unknown;
  percent: number | null;
  created_at: string;
};

export type PostgresTaskNames = {
  schema: string;
  tasksTable: string;
  stepsTable: string;
  tasksQualified: string;
  stepsQualified: string;
};

export type PostgresTaskStoreContext = {
  client: PostgresTaskStoreOptions["client"];
  names: PostgresTaskNames;
};

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function resolveNames(options: PostgresTaskSchemaOptions = {}): PostgresTaskNames {
  const schema = options.schema || "public";
  const tablePrefix = options.tablePrefix || "tb_";
  const tasksTable = `${tablePrefix}tasks`;
  const stepsTable = `${tablePrefix}task_steps`;

  return {
    schema,
    tasksTable,
    stepsTable,
    tasksQualified: `${quoteIdentifier(schema)}.${quoteIdentifier(tasksTable)}`,
    stepsQualified: `${quoteIdentifier(schema)}.${quoteIdentifier(stepsTable)}`,
  };
}

async function withTransaction<T>(
  client: PostgresTaskStoreOptions["client"],
  run: (tx: PostgresTaskPoolClient) => Promise<T>,
): Promise<T> {
  const tx = await client.connect();
  try {
    await tx.query("begin");
    const result = await run(tx);
    await tx.query("commit");
    return result;
  } catch (error) {
    await tx.query("rollback");
    throw error;
  } finally {
    tx.release();
  }
}

function mapTaskRow(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    input: parseJsonValue(row.input, null),
    output: parseJsonValue(row.output, null),
    error: parseJsonValue<TaskTerminalError | null>(row.error, null),
    metadata: parseJsonValue(row.metadata, {}),
    progressPercent: typeof row.progress_percent === "number" ? row.progress_percent : null,
    progressLabel: row.progress_label,
    progressMeta: parseJsonValue(row.progress_meta, null),
    concurrencyKey: row.concurrency_key,
    dedupeKey: row.dedupe_key,
    supersedeKey: row.supersede_key,
    channels: normalizeTaskChannels(parseJsonValue(row.channels, [])),
    attempt: Number(row.attempt || 0),
    maxAttempts: Number(row.max_attempts || 1),
    scheduledAt: nowIso(row.scheduled_at),
    createdAt: nowIso(row.created_at),
    updatedAt: nowIso(row.updated_at),
    claimedAt: row.claimed_at ? nowIso(row.claimed_at) : null,
    startedAt: row.started_at ? nowIso(row.started_at) : null,
    finishedAt: row.finished_at ? nowIso(row.finished_at) : null,
    cancelRequestedAt: row.cancel_requested_at ? nowIso(row.cancel_requested_at) : null,
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at ? nowIso(row.lease_expires_at) : null,
    lastHeartbeatAt: row.last_heartbeat_at ? nowIso(row.last_heartbeat_at) : null,
    retryScheduledAt: row.retry_scheduled_at ? nowIso(row.retry_scheduled_at) : null,
    staleAt: row.stale_at ? nowIso(row.stale_at) : null,
    staleReason: row.stale_reason,
  };
}

function mapStepRow(row: TaskStepRow): TaskStepRecord {
  return {
    id: String(row.id),
    taskId: row.task_id,
    attempt: Number(row.attempt || 0),
    kind: row.kind,
    level: row.level,
    message: row.message,
    meta: parseJsonValue(row.meta, null),
    percent: typeof row.percent === "number" ? row.percent : null,
    createdAt: nowIso(row.created_at),
  };
}

function taskToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export {
  mapStepRow,
  mapTaskRow,
  quoteIdentifier,
  resolveNames,
  taskToken,
  withTransaction,
};
