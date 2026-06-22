import { createRequire } from "node:module";

import type {
  SqliteTaskDatabase,
  SqliteTaskSchemaOptions,
  SqliteTaskStatement,
  SqliteTaskStatementResult,
  SqliteTaskStoreOptions,
  TaskRecord,
  TaskStatus,
  TaskStepRecord,
  TaskTerminalError,
} from "#2kjvrax0gr4m";
import { nowIso, parseJsonValue, taskId } from "#qysd2ddsh0x8";
import { normalizeTaskChannels } from "#xx6ozac2scdj";

const require = createRequire(import.meta.url);

type SqliteTaskRow = {
  id: string;
  kind: string;
  status: TaskStatus;
  input: string | null;
  output: string | null;
  error: string | null;
  metadata: string | null;
  progress_percent: number | null;
  progress_label: string | null;
  progress_meta: string | null;
  concurrency_key: string | null;
  dedupe_key: string | null;
  supersede_key: string | null;
  channels: string | null;
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

type SqliteTaskStepRow = {
  id: number | string;
  task_id: string;
  attempt: number;
  kind: string;
  level: string;
  message: string;
  meta: string | null;
  percent: number | null;
  created_at: string;
};

type SqliteTaskNames = {
  tasksTable: string;
  stepsTable: string;
};

type SqliteTaskStoreContext = {
  db: SqliteTaskDatabase;
  names: SqliteTaskNames;
};

type OpenSqliteDatabaseResult = {
  database: SqliteTaskDatabase;
  ownsDatabase: boolean;
};

function resolveSqliteNames(options: SqliteTaskSchemaOptions = {}): SqliteTaskNames {
  const tablePrefix = options.tablePrefix || "tb_";

  return {
    tasksTable: `${tablePrefix}tasks`,
    stepsTable: `${tablePrefix}task_steps`,
  };
}

function createSqliteTaskContext(options: SqliteTaskStoreOptions): SqliteTaskStoreContext {
  return {
    db: resolveSqliteDatabase(options).database,
    names: resolveSqliteNames(options),
  };
}

function resolveSqliteDatabase(options: SqliteTaskSchemaOptions = {}): OpenSqliteDatabaseResult {
  const database = options.database ?? openSqliteDatabaseFromPath(options.path || "tasks.sqlite");
  applySqlitePragmas(database, options);

  return {
    database,
    ownsDatabase: !options.database,
  };
}

function openSqliteDatabaseFromPath(path: string): SqliteTaskDatabase {
  const bunDatabase = tryOpenBunSqlite(path);
  if (bunDatabase) {
    return bunDatabase;
  }

  const nodeDatabase = tryOpenNodeSqlite(path);
  if (nodeDatabase) {
    return nodeDatabase;
  }

  const betterDatabase = tryOpenBetterSqlite(path);
  if (betterDatabase) {
    return betterDatabase;
  }

  throw new Error(
    "SQLite support requires Bun with bun:sqlite, Node with node:sqlite, or better-sqlite3 installed.",
  );
}

function tryOpenBunSqlite(path: string): SqliteTaskDatabase | null {
  try {
    const mod = require("bun:sqlite") as {
      Database: new (path: string) => SqliteTaskDatabase;
    };
    return new mod.Database(path);
  } catch {
    return null;
  }
}

function tryOpenNodeSqlite(path: string): SqliteTaskDatabase | null {
  try {
    const mod = require("node:sqlite") as {
      DatabaseSync: new (path: string) => SqliteTaskDatabase;
    };
    return new mod.DatabaseSync(path);
  } catch {
    return null;
  }
}

function tryOpenBetterSqlite(path: string): SqliteTaskDatabase | null {
  try {
    const BetterSqlite = require("better-sqlite3") as new (path: string) => SqliteTaskDatabase;
    return new BetterSqlite(path);
  } catch {
    return null;
  }
}

function applySqlitePragmas(database: SqliteTaskDatabase, options: SqliteTaskSchemaOptions): void {
  const pragmas = options.pragmas?.length
    ? options.pragmas
    : [
      "pragma journal_mode = wal",
      "pragma synchronous = normal",
      "pragma foreign_keys = on",
      `pragma busy_timeout = ${Math.max(0, options.busyTimeoutMs ?? 5_000)}`,
    ];

  for (const pragma of pragmas) {
    database.exec(`${pragma};`);
  }
}

function withSqliteTransaction<T>(database: SqliteTaskDatabase, run: () => T): T {
  database.exec("begin immediate;");

  try {
    const result = run();
    database.exec("commit;");
    return result;
  } catch (error) {
    database.exec("rollback;");
    throw error;
  }
}

function mapSqliteTaskRow(row: SqliteTaskRow): TaskRecord {
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

function mapSqliteStepRow(row: SqliteTaskStepRow): TaskStepRecord {
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

function executeAll<T = Record<string, unknown>>(
  database: SqliteTaskDatabase,
  sql: string,
  params: unknown[] = [],
): T[] {
  return prepareStatement(database, sql).all<T>(...params);
}

function executeGet<T = Record<string, unknown>>(
  database: SqliteTaskDatabase,
  sql: string,
  params: unknown[] = [],
): T | null {
  return prepareStatement(database, sql).get<T>(...params) ?? null;
}

function executeRun(
  database: SqliteTaskDatabase,
  sql: string,
  params: unknown[] = [],
): SqliteTaskStatementResult | unknown {
  return prepareStatement(database, sql).run(...params);
}

function readSqliteChanges(result: SqliteTaskStatementResult | unknown): number {
  if (!result || typeof result !== "object") {
    return 0;
  }

  const value = result as SqliteTaskStatementResult;
  if (typeof value.changes === "bigint") {
    return Number(value.changes);
  }

  return typeof value.changes === "number" ? value.changes : 0;
}

function prepareStatement(database: SqliteTaskDatabase, sql: string): SqliteTaskStatement {
  return database.prepare(sql);
}

function sqliteTaskToken(): string {
  return taskId();
}

export {
  applySqlitePragmas,
  createSqliteTaskContext,
  executeAll,
  executeGet,
  executeRun,
  mapSqliteStepRow,
  mapSqliteTaskRow,
  readSqliteChanges,
  resolveSqliteDatabase,
  resolveSqliteNames,
  sqliteTaskToken,
  withSqliteTransaction,
};

export type {
  OpenSqliteDatabaseResult,
  SqliteTaskNames,
  SqliteTaskRow,
  SqliteTaskStepRow,
  SqliteTaskStoreContext,
};
