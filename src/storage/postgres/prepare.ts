import type { PostgresTaskStoreOptions } from "#2kjvrax0gr4m";
import { createPostgresTaskStoreSchema } from "./schema.js";

async function preparePostgresTaskStoreSchema(options: PostgresTaskStoreOptions): Promise<void> {
  await options.client.query(createPostgresTaskStoreSchema(options));
}

export {
  preparePostgresTaskStoreSchema,
};
