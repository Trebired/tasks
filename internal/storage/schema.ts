import type { TaskStoreSchemaFactoryOptions } from "#2kjvrax0gr4m";
import { createPostgresTaskStoreSchema } from "./postgres/schema.js";
import { createSqliteTaskStoreSchema } from "./sqlite/schema.js";

function createTaskStoreSchema(options: TaskStoreSchemaFactoryOptions): string {
  if (options.driver === "postgres") {
    return createPostgresTaskStoreSchema(options.postgres);
  }

  return createSqliteTaskStoreSchema(options.sqlite);
}

export {
  createTaskStoreSchema,
};
