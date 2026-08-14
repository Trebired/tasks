import type { TaskStoreSchemaFactoryOptions } from "#2kjvrax0gr4m";
import { loadCachedConfigSync, mergeTaskStoreOptions } from "#kpb3tx22xs9n";
import { createPostgresTaskStoreSchema } from "./postgres/schema.js";
import { createSqliteTaskStoreSchema } from "./sqlite/schema.js";

function createTaskStoreSchema(options: TaskStoreSchemaFactoryOptions): string {
  const resolvedOptions = mergeTaskStoreOptions(loadCachedConfigSync(), options);
  if (resolvedOptions.driver === "postgres") {
    return createPostgresTaskStoreSchema(resolvedOptions.postgres);
  }

  return createSqliteTaskStoreSchema(resolvedOptions.sqlite);
}

export {
  createTaskStoreSchema,
};
