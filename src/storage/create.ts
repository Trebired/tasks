import type {
  TaskStore,
  TaskStoreFactoryOptions,
} from "#2kjvrax0gr4m";
import { createPostgresTaskStore } from "./postgres/create.js";
import { createSqliteTaskStore } from "./sqlite/create.js";

function createTaskStore(options: TaskStoreFactoryOptions): TaskStore {
  if (options.driver === "postgres") {
    return createPostgresTaskStore(options.postgres);
  }

  return createSqliteTaskStore(options.sqlite);
}

export {
  createTaskStore,
};
