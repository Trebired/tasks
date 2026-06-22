export type PostgresTaskQueryResult<T = Record<string, unknown>> = {
  rows: T[];
  rowCount?: number | null;
};

export type PostgresTaskQueryable = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<PostgresTaskQueryResult<T>>;
};

export type PostgresTaskPoolClient = PostgresTaskQueryable & {
  release: () => void;
};

export type PostgresTaskPool = PostgresTaskQueryable & {
  connect: () => Promise<PostgresTaskPoolClient>;
};

export type PostgresTaskStoreOptions = {
  client: PostgresTaskPool;
  schema?: string;
  tablePrefix?: string;
};

export type PostgresTaskSchemaOptions = {
  schema?: string;
  tablePrefix?: string;
};

export type SqliteTaskStatementResult = {
  changes?: number | bigint;
  lastInsertRowid?: number | bigint;
};

export type SqliteTaskStatement = {
  run: (...params: unknown[]) => SqliteTaskStatementResult | unknown;
  get: <T = Record<string, unknown>>(...params: unknown[]) => T | undefined;
  all: <T = Record<string, unknown>>(...params: unknown[]) => T[];
};

export type SqliteTaskDatabase = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => SqliteTaskStatement;
  close?: () => void;
};

export type SqliteTaskSchemaOptions = {
  path?: string;
  database?: SqliteTaskDatabase;
  tablePrefix?: string;
  pragmas?: string[];
  busyTimeoutMs?: number;
};

export type SqliteTaskStoreOptions = SqliteTaskSchemaOptions;

export type InProcessTaskModuleLoader = (
  specifier: string,
) => Promise<Record<string, unknown>>;

export type InProcessTaskExecutorOptions = {
  loadModule?: InProcessTaskModuleLoader;
};

export type ChildProcessTaskExecutorOptions = {
  command?: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  killTimeoutMs?: number;
};

export type TaskStoreDriver = "postgres" | "sqlite";

export type TaskStoreFactoryOptions =
  | {
      driver: "postgres";
      postgres: PostgresTaskStoreOptions;
    }
  | {
      driver: "sqlite";
      sqlite: SqliteTaskStoreOptions;
    };

export type TaskStoreSchemaFactoryOptions =
  | {
      driver: "postgres";
      postgres?: PostgresTaskSchemaOptions;
    }
  | {
      driver: "sqlite";
      sqlite?: SqliteTaskSchemaOptions;
    };

export type TaskStorePrepareOptions =
  | {
      driver: "postgres";
      postgres: PostgresTaskStoreOptions;
    }
  | {
      driver: "sqlite";
      sqlite?: SqliteTaskSchemaOptions;
    };
