import { Pool } from "pg";
import {
  createPostgresTaskStore,
  createPostgresTaskStoreSchema,
  createTaskHost,
} from "../src/index";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Set DATABASE_URL to run the Postgres example");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
  });

  await pool.query(createPostgresTaskStoreSchema());

  const tasks = createTaskHost({
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

  tasks.onEvent((event) => {
    if (event.type === "task:progress") {
      console.log("progress", event.taskId, event.task?.progressPercent, event.task?.progressLabel);
    }

    if (event.type === "task:step") {
      console.log("step", event.taskId, event.step?.label);
    }

    if (event.type === "task:succeeded") {
      console.log("done", event.taskId, event.output);
    }
  });

  await tasks.start();

  const queued = await tasks.enqueue("report.generate", {
    reportId: "rpt_demo",
  }, {
    dedupeKey: "report:rpt_demo",
    concurrencyKey: "report:rpt_demo",
  });

  console.log("queued", queued.task.id, queued.deduplicated);

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const task = await tasks.getTask(queued.task.id);
    if (!task) {
      break;
    }

    if (task.status === "succeeded" || task.status === "failed" || task.status === "cancelled") {
      console.log("final", task.status, task.output, task.error);
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const steps = await tasks.listTaskSteps(queued.task.id);
  console.log("steps", steps.length);

  await tasks.stop();
  await pool.end();
}

void main();
