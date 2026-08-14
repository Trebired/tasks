import type {
  TaskStore,
  TaskStoreFactoryOptions,
} from "#2kjvrax0gr4m";
import { loadCachedConfigSync, mergeTaskStoreOptions } from "#kpb3tx22xs9n";
import { createPostgresTaskStore } from "./postgres/create.js";
import { createSqliteTaskStore } from "./sqlite/create.js";

function createTaskStore(options: TaskStoreFactoryOptions): TaskStore {
  const resolvedOptions = mergeTaskStoreOptions(loadCachedConfigSync(), options);
  if (resolvedOptions.driver === "postgres") {
    return createPostgresTaskStore(resolvedOptions.postgres);
  }

  return createSqliteTaskStore(resolvedOptions.sqlite);
}

export {
  createTaskStore,
};
