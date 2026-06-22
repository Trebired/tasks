import type { SqliteTaskSchemaOptions } from "#2kjvrax0gr4m";
import { createSqliteTaskStoreSchema } from "./schema.js";
import { resolveSqliteDatabase } from "./shared.js";

async function prepareSqliteTaskStoreSchema(options: SqliteTaskSchemaOptions = {}): Promise<void> {
  const resolved = resolveSqliteDatabase(options);

  try {
    resolved.database.exec(createSqliteTaskStoreSchema(options));
  } finally {
    if (resolved.ownsDatabase) {
      resolved.database.close?.();
    }
  }
}

export {
  prepareSqliteTaskStoreSchema,
};
