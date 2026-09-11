import { Pool } from "pg";

import {
  createPostgresTaskStore,
  createTaskHost,
  preparePostgresTaskStoreSchema,
} from "#8t8bq600b4wu";
import { resolveLogger } from "@package/logger-adapter";

const log = resolveLogger({ source: "@trebired/tasks" });

function createDemoTaskHost(pool: Pool) {
  return createTaskHost({
      store: createPostgresTaskStore({
          client: pool,
      }),
      handlers: [
        {
          kind: "report.generate",
          entrypoint: {
            module: new URL("./handlers/report_task.ts", import.meta.url),
          },
          concurrency: {
            limit: 2,
          },
          retry: {
            maxAttempts: 3,
          },
        },
      ],
      runner: {
        globalConcurrency: 4,
      },
  });
}

function attachConsoleEvents(tasks: ReturnType<typeof createTaskHost>) {
  tasks.onEvent((event) => {
      if (event.type === "task:progress") {
        log.info("example.postgres-child-process", "progress", {
            taskId: event.taskId,
            percent: event.task?.progressPercent,
            label: event.task?.progressLabel,
        });
      }
      if (event.type === "task:step") {
        log.info("example.postgres-child-process", "step", { taskId: event.taskId, message: event.step?.message });
      }
      if (event.type === "task:succeeded") {
        log.info("example.postgres-child-process", "done", { taskId: event.taskId, output: event.output });
      }
  });
}

async function waitForTask(tasks: ReturnType<typeof createTaskHost>, taskId: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const task = await tasks.getTask(taskId);
    if (!task) {
      break;
    }
    if (task.status === "succeeded" || task.status === "failed" || task.status === "cancelled") {
      log.info("example.postgres-child-process", "final", {
          status: task.status,
          output: task.output,
          error: task.error,
      });
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Set DATABASE_URL to run the Postgres example");
  }

  const pool = new Pool({
      connectionString: databaseUrl,
  });

  await preparePostgresTaskStoreSchema({ client: pool });
  const tasks = createDemoTaskHost(pool);

  try {
    attachConsoleEvents(tasks);
    await tasks.start();

    const queued = await tasks.enqueue("report.generate", {
        reportId: "rpt_demo",
      }, {
        dedupeKey: "report:rpt_demo",
        concurrencyKey: "report:rpt_demo",
    });

    log.info("example.postgres-child-process", "queued", {
        taskId: queued.task.id,
        deduplicated: queued.deduplicated,
    });
    await waitForTask(tasks, queued.task.id);

    const steps = await tasks.listTaskSteps(queued.task.id);
    log.info("example.postgres-child-process", "steps", { count: steps.length });
  } finally {
    await tasks.stop();
    await pool.end();
  }
}

void main();
