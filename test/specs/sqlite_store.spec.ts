import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  createInProcessTaskExecutor,
  createTaskHost,
  createTaskStore,
  createTaskStoreSchema,
  prepareTaskStoreSchema,
  taskChannel,
} from "#8t8bq600b4wu";

function createFixtureUrl(name: string): URL {
  return new URL(`../fixtures/${name}`, import.meta.url);
}

async function waitForTaskCompletion(
  tasks: ReturnType<typeof createTaskHost>,
  taskId: string,
): Promise<Awaited<ReturnType<typeof tasks.readSnapshot>>> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const snapshot = await tasks.readSnapshot(taskId, {
      includeSteps: 10,
    });

    if (snapshot && ["succeeded", "failed", "cancelled"].includes(snapshot.state)) {
      return snapshot;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for task ${taskId}`);
}

describe("@trebired/tasks sqlite store", () => {
  test("supports the generic sqlite store factory and persists task history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trebired-tasks-sqlite-"));
    const path = join(directory, "tasks.sqlite");

    try {
      const schemaSql = createTaskStoreSchema({
        driver: "sqlite",
        sqlite: {
          path,
        },
      });

      expect(schemaSql.includes("create table if not exists \"tb_tasks\"")).toBe(true);
      expect(schemaSql.includes("create unique index if not exists \"tb_tasks_open_dedupe_idx\"")).toBe(true);

      await prepareTaskStoreSchema({
        driver: "sqlite",
        sqlite: {
          path,
        },
      });

      const store = createTaskStore({
        driver: "sqlite",
        sqlite: {
          path,
        },
      });
      const tasks = createTaskHost({
        store,
        executor: createInProcessTaskExecutor(),
        handlers: [
          {
            kind: "example.run",
            entrypoint: {
              module: createFixtureUrl("in_process_success.ts"),
            },
          },
        ],
        runner: {
          globalConcurrency: 1,
          pollIntervalMs: 10,
          heartbeatMs: 20,
          leaseMs: 100,
        },
      });

      await tasks.start();

      const queued = await tasks.enqueue("example.run", {
        value: "sqlite",
      }, {
        dedupeKey: "example:sqlite",
        concurrencyKey: "example:sqlite",
        channels: [
          taskChannel.scope("sqlite"),
        ],
      });
      const duplicate = await tasks.enqueue("example.run", {
        value: "sqlite",
      }, {
        dedupeKey: "example:sqlite",
      });

      expect(duplicate.disposition).toBe("reused");
      expect(duplicate.task.id).toBe(queued.task.id);

      const snapshot = await waitForTaskCompletion(tasks, queued.task.id);

      expect(snapshot?.state).toBe("succeeded");
      expect(snapshot?.output).toEqual({
        echoed: "sqlite",
      });
      expect(snapshot?.steps?.map((step) => step.message)).toEqual([
        "Halfway there",
      ]);

      await tasks.stop();

      const reopened = createTaskStore({
        driver: "sqlite",
        sqlite: {
          path,
        },
      });
      const persisted = await reopened.getTask(queued.task.id);
      const steps = await reopened.listTaskSteps(queued.task.id);

      expect(persisted?.output).toEqual({
        echoed: "sqlite",
      });
      expect(steps).toHaveLength(1);
      expect(steps[0]?.message).toBe("Halfway there");
    } finally {
      await rm(directory, {
        force: true,
        recursive: true,
      });
    }
  });
});
