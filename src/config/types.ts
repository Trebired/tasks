import type {
  PostgresTaskSchemaOptions,
  SqliteTaskSchemaOptions,
  TaskRetryBackoff,
  TaskRunnerOptions,
  TaskStoreFactoryOptions,
  TaskStorePrepareOptions,
  TaskStoreSchemaFactoryOptions,
} from "#2kjvrax0gr4m";

type TasksConfig = {
  defaults?: {
    maxAttempts?: number;
    retryBackoff?: TaskRetryBackoff;
  };
  forVersion?: string;
  runner?: TaskRunnerOptions;
  storage?: {
    postgres?: PostgresTaskSchemaOptions;
    sqlite?: Omit<SqliteTaskSchemaOptions, "database">;
  };
};

type NormalizedTasksConfig = {
  defaults: {
    maxAttempts?: number;
    retryBackoff?: TaskRetryBackoff;
  };
  forVersion: string;
  runner: TaskRunnerOptions;
  storage: {
    postgres?: PostgresTaskSchemaOptions;
    sqlite?: Omit<SqliteTaskSchemaOptions, "database">;
  };
};

type LoadedTasksConfig = {
  config: NormalizedTasksConfig;
  configPath: string | null;
  dependencies: string[];
};

type LoadTasksConfigOptions = {
  configPath?: string;
  defaultIfMissing?: boolean;
  searchFrom?: string;
};

type TasksStoreOptions =
|TaskStoreFactoryOptions
|TaskStorePrepareOptions
|TaskStoreSchemaFactoryOptions;

export type {
  LoadedTasksConfig,
  LoadTasksConfigOptions,
  NormalizedTasksConfig,
  TasksConfig,
  TasksStoreOptions,
};
