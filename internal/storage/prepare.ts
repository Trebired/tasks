import type { TaskStorePrepareOptions } from "#2kjvrax0gr4m";
import { preparePostgresTaskStoreSchema } from "./postgres/prepare.js";
import { prepareSqliteTaskStoreSchema } from "./sqlite/prepare.js";

async function prepareTaskStoreSchema(options: TaskStorePrepareOptions): Promise<void> {
  if (options.driver === "postgres") {
    await preparePostgresTaskStoreSchema(options.postgres);
    return;
  }

  await prepareSqliteTaskStoreSchema(options.sqlite);
}

export {
  prepareTaskStoreSchema,
};
