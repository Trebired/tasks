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

export type ChildProcessTaskExecutorOptions = {
  command?: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  killTimeoutMs?: number;
};
