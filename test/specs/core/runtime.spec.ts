import { expect, test } from "bun:test";

import { createTaskHost, taskChannel } from "#8t8bq600b4wu";

import { createLifecycleExecutor, createReportTaskModuleUrl, waitForTaskToReachState } from "./support/live";
import { MemoryTaskStore } from "./support/store";

test("runs a queued task, exposes snapshots, and normalizes lifecycle events", async () => {
  const store = new MemoryTaskStore();
  const lifecycleEvents: string[] = [];
  const tasks = createTaskHost({
    store,
    executor: createLifecycleExecutor(),
    handlers: [
      {
        kind: "demo.run",
        entrypoint: {
          module: createReportTaskModuleUrl(),
        },
      },
    ],
    runner: {
      pollIntervalMs: 10,
      heartbeatMs: 20,
      leaseMs: 100,
      globalConcurrency: 1,
    },
    onLifecycleEvent(event) {
      lifecycleEvents.push(event.event);
    },
  });

  await tasks.start();
  const queued = await tasks.enqueue("demo.run", { id: "demo" }, {
    channels: [taskChannel.scope("workspace:demo")],
  });
  await waitForTaskToReachState(async () => (await tasks.getTask(queued.task.id))?.status, "succeeded");

  const snapshot = await tasks.readSnapshot<{ id: string }, { ok: boolean }>(queued.task.id, {
    includeSteps: 10,
  });
  const aggregate = await tasks.readAggregate();

  expect(snapshot?.state).toBe("succeeded");
  expect(snapshot?.progress.percent).toBe(100);
  expect(snapshot?.steps).toHaveLength(1);
  expect(snapshot?.steps?.[0]?.message).toBe("Started unit of work");
  expect(snapshot?.channels.includes(taskChannel.task(queued.task.id))).toBe(true);
  expect(aggregate.byState.succeeded).toBe(1);
  expect(lifecycleEvents.includes("progress")).toBe(true);
  expect(lifecycleEvents.includes("step")).toBe(true);
  expect(lifecycleEvents[lifecycleEvents.length - 1]).toBe("succeeded");

  await tasks.stop();
});

test("filters bootstrap state by package-owned subscription keys and generic channels", async () => {
  const store = new MemoryTaskStore();
  const tasks = createTaskHost({ store });

  await tasks.enqueue("demo.filter", { id: "keep" }, {
    dedupeKey: "shared",
    concurrencyKey: "resource:42",
    channels: [
      taskChannel.scope("workspace:42"),
      taskChannel.resource("repo:42"),
      taskChannel.correlation("request:abc"),
      taskChannel.topic("imports"),
    ],
  });
  await tasks.enqueue("demo.filter", { id: "skip" }, {
    dedupeKey: "other",
    concurrencyKey: "resource:99",
    channels: [taskChannel.scope("workspace:99"), taskChannel.resource("repo:99")],
  });

  const bootstrap = await tasks.bootstrap({
    dedupeKey: "shared",
    concurrencyKey: "resource:42",
    channels: [taskChannel.resource("repo:42")],
  });

  expect(bootstrap.snapshots).toHaveLength(1);
  expect(bootstrap.snapshots[0]?.dedupeKey).toBe("shared");
  expect(bootstrap.snapshots[0]?.concurrencyKey).toBe("resource:42");
  expect(bootstrap.snapshots[0]?.channels.includes(taskChannel.topic("imports"))).toBe(true);
  expect(bootstrap.snapshots[0]?.channels.includes(taskChannel.correlation("request:abc"))).toBe(true);
});
