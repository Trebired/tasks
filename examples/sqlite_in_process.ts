import { join } from "node:path";

import {
  createInProcessTaskExecutor,
  createTaskHost,
  createTaskStore,
  prepareTaskStoreSchema,
} from "#8t8bq600b4wu";

function createSqliteOptions(path: string) {
  return {
    driver: "sqlite" as const,
    sqlite: {
      path,
    },
  };
}

function createSqliteTaskHost(path: string) {
  return createTaskHost({
    store: createTaskStore(createSqliteOptions(path)),
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
}

async function waitForSnapshot(tasks: ReturnType<typeof createTaskHost>, taskId: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const snapshot = await tasks.readSnapshot(taskId, {
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
}

async function main() {
  const path = join(process.cwd(), ".tmp", "examples", "tasks.sqlite");
  await prepareTaskStoreSchema(createSqliteOptions(path));
  const tasks = createSqliteTaskHost(path);

  try {
    await tasks.start();
    const queued = await tasks.enqueue("report.generate", {
      reportId: "rpt_sqlite_demo",
    });
    console.log("queued", queued.task.id);
    await waitForSnapshot(tasks, queued.task.id);
  } finally {
    await tasks.stop();
  }
}

void main();
