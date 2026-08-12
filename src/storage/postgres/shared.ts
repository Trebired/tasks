import type {
  PostgresTaskPoolClient,
  PostgresTaskSchemaOptions,
  PostgresTaskStoreOptions,
  TaskRecord,
  TaskStatus,
  TaskStepRecord,
} from "#2kjvrax0gr4m";
import {
  mapStorageStepRow,
  mapStorageTaskRow,
} from "#biq6enncufmz";

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

const mapTaskRow = mapStorageTaskRow as(row: TaskRow) => TaskRecord;
const mapStepRow = mapStorageStepRow as(row: TaskStepRow) => TaskStepRecord;

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
