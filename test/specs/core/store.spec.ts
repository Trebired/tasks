import { expect, test } from "bun:test";

import {
  createPostgresTaskStoreSchema,
  createTaskHost,
  defineTaskHandler,
  taskChannel,
} from "#8t8bq600b4wu";
import { createTaskSnapshot } from "#ir9grtwyf3f1";

import { MemoryTaskStore } from "./support/store";

test("marks long-running work as stale through the package-owned stale model", async () => {
  const store = new MemoryTaskStore();
  const queued = await store.createTask({
    id: "stale-task",
    kind: "demo.stale",
    input: { id: "stale" },
    maxAttempts: 1,
    scheduledAt: new Date().toISOString(),
  });
  const claimed = await store.claimNextTask({
    runnerId: "runner-1",
    leaseMs: 1_000,
    kinds: ["demo.stale"],
  });

  expect(claimed?.status).toBe("claimed");

  if (claimed) {
    claimed.status = "running";
    claimed.updatedAt = new Date(Date.now() - 10_000).toISOString();
    claimed.lastHeartbeatAt = new Date(Date.now() - 10_000).toISOString();
    store.tasks.set(claimed.id, claimed);
  }

  const stale = await store.markStaleTasks({
    staleAfterMs: 1_000,
    now: new Date().toISOString(),
    reason: "watchdog timeout",
  });
  const staleSnapshot = createTaskSnapshot(stale[0]);

  expect(queued.disposition).toBe("created");
  expect(stale).toHaveLength(1);
  expect(staleSnapshot.state).toBe("stale");
  expect(staleSnapshot.progress.staleReason).toBe("watchdog timeout");
});

test("surfaces dedupe reuse and supersedence explicitly", async () => {
  const store = new MemoryTaskStore();
  const tasks = createTaskHost({ store });
  const first = await tasks.enqueue("demo.dedupe", { id: 1 }, {
    dedupeKey: "same",
    supersedeKey: "same",
    channels: [taskChannel.scope("demo")],
  });
  const second = await tasks.enqueue("demo.dedupe", { id: 2 }, {
    dedupeKey: "same",
    channels: [taskChannel.scope("demo")],
  });
  const replacement = await tasks.enqueue("demo.replace", { id: 3 }, {
    supersedeKey: "replace",
  });
  const replaced = await tasks.enqueue("demo.replace", { id: 4 }, {
    supersedeKey: "replace",
    supersedeExisting: true,
  });

  expect(first.disposition).toBe("created");
  expect(second.disposition).toBe("reused");
  expect(second.reusedTaskId).toBe(first.task.id);
  expect(replacement.disposition).toBe("created");
  expect(replaced.disposition).toBe("superseded");
  expect(replaced.supersededTaskIds).toHaveLength(1);
});

test("defines handlers and builds postgres schema sql", () => {
  const handler = defineTaskHandler({
    async run() {
      return {
        ok: true,
      };
    },
  });
  const sql = createPostgresTaskStoreSchema({
    schema: "app",
    tablePrefix: "tb_",
  });

  expect(typeof handler.run).toBe("function");
  expect(sql.includes("create schema if not exists")).toBe(true);
  expect(sql.includes("\"app\".\"tb_tasks\"")).toBe(true);
  expect(sql.includes("supersede_key")).toBe(true);
  expect(sql.includes("channels jsonb")).toBe(true);
});
