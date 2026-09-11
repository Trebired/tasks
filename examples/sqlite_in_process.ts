import { join } from "node:path";

import {
  createInProcessTaskExecutor,
  createTaskHost,
  createTaskStore,
  prepareTaskStoreSchema,
} from "#8t8bq600b4wu";
import { resolveLogger } from "@package/logger-adapter";

const log = resolveLogger({ source: "@trebired/tasks" });

function createSqliteOptions(path: string) {
  return {
    driver: "sqlite"as const,
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
      log.info("example.sqlite-in-process", "final", {
          state: snapshot.state,
          output: snapshot.output,
          error: snapshot.error,
      });
      log.info("example.sqlite-in-process", "steps", { count: snapshot.steps?.length ?? 0 });
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
    log.info("example.sqlite-in-process", "queued", { taskId: queued.task.id });
    await waitForSnapshot(tasks, queued.task.id);
  } finally {
    await tasks.stop();
  }
}

void main();
