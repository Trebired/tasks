import type { TaskStorePrepareOptions } from "#2kjvrax0gr4m";
import { loadCachedConfigSync, mergeTaskStoreOptions } from "#kpb3tx22xs9n";
import { preparePostgresTaskStoreSchema } from "./postgres/prepare.js";
import { prepareSqliteTaskStoreSchema } from "./sqlite/prepare.js";

async function prepareTaskStoreSchema(options: TaskStorePrepareOptions): Promise<void> {
  const resolvedOptions = mergeTaskStoreOptions(loadCachedConfigSync(), options);
  if (resolvedOptions.driver === "postgres") {
    await preparePostgresTaskStoreSchema(resolvedOptions.postgres);
    return;
  }

  await prepareSqliteTaskStoreSchema(resolvedOptions.sqlite);
}

export {
  prepareTaskStoreSchema,
};
