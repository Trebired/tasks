import { join } from "node:path";

import {
  createInProcessTaskExecutor,
  createTaskHost,
  createTaskStore,
  prepareTaskStoreSchema,
} from "#8t8bq600b4wu";

async function main() {
  const path = join(process.cwd(), ".tmp", "examples", "tasks.sqlite");

  await prepareTaskStoreSchema({
    driver: "sqlite",
    sqlite: {
      path,
    },
  });

  const tasks = createTaskHost({
    store: createTaskStore({
      driver: "sqlite",
      sqlite: {
        path,
      },
    }),
    executor: createInProcessTaskExecutor(),
    handlers: [
      {
        kind: "report.generate",
        entrypoint: {
          module: new URL("./handlers/report_task.ts", import.meta.url),
        },
      },
    ],
    runner: {
      globalConcurrency: 1,
    },
  });

  await tasks.start();

  const queued = await tasks.enqueue("report.generate", {
    reportId: "rpt_sqlite_demo",
  });

  console.log("queued", queued.task.id);

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const snapshot = await tasks.readSnapshot(queued.task.id, {
      includeSteps: 20,
    });

    if (!snapshot) {
      break;
    }

    if (snapshot.state === "succeeded" || snapshot.state === "failed" || snapshot.state === "cancelled") {
      console.log("final", snapshot.state, snapshot.output, snapshot.error);
      console.log("steps", snapshot.steps?.length ?? 0);
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  await tasks.stop();
}

void main();
