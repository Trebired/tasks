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
} from "#2kjvrax0gr4m";
import { taskId } from "#92c6666f713d";
import {
  mapStorageStepRow,
  mapStorageTaskRow,
} from "#biq6enncufmz";

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
      Database: new(path: string) => SqliteTaskDatabase;
    };
    return new mod.Database(path);
  } catch {
    return null;
  }
}

function tryOpenNodeSqlite(path: string): SqliteTaskDatabase | null {
  try {
    const mod = require("node:sqlite") as {
      DatabaseSync: new(path: string) => SqliteTaskDatabase;
    };
    return new mod.DatabaseSync(path);
  } catch {
    return null;
  }
}

function tryOpenBetterSqlite(path: string): SqliteTaskDatabase | null {
  try {
    const BetterSqlite = require("better-sqlite3") as new(path: string) => SqliteTaskDatabase;
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

const mapSqliteTaskRow = mapStorageTaskRow as(row: SqliteTaskRow) => TaskRecord;
const mapSqliteStepRow = mapStorageStepRow as(row: SqliteTaskStepRow) => TaskStepRecord;

function executeAll<T=Record<string, unknown>>(
  database: SqliteTaskDatabase,
  sql: string,
  params: unknown[] = [],
): T[] {
  return prepareStatement(database, sql).all<T>(...params);
}

function executeGet<T=Record<string, unknown>>(
  database: SqliteTaskDatabase,
  sql: string,
  params: unknown[] = [],
): T | null {
  return prepareStatement(database, sql).get<T>(...params) ?? null;
}

function readSqliteTaskById<TInput=unknown, TResult=unknown>(
  context: SqliteTaskStoreContext,
  taskIdValue: string,
): TaskRecord<TInput, TResult>|null {
  const row = executeGet<SqliteTaskRow>(
    context.db,
    `select * from "${context.names.tasksTable}" where id = ? limit 1`,
    [taskIdValue],
  );

  return (row ? mapSqliteTaskRow(row) : null) as TaskRecord<TInput, TResult>|null;
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
  readSqliteTaskById,
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
