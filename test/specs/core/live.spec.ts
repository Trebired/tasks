import { expect, test } from "bun:test";

import {
  attachTaskLiveSocketBridge,
  createTaskLiveHub,
  createTaskLiveTracker,
  taskChannel,
} from "#8t8bq600b4wu";

import {
  FakeSocketServer,
  createDemoTaskHost,
  findSucceededSocketEvent,
  waitForSocketSuccessEvent,
  waitForTaskToReachState,
} from "./support/live";
import { MemoryTaskStore } from "./support/store";

test("bootstraps live state and tracks later updates", async () => {
  const store = new MemoryTaskStore();
  const tasks = createDemoTaskHost(store, "demo.live", "phase one", { done: true });

  await tasks.start();
  const queued = await tasks.enqueue("demo.live", { id: "live" }, {
    channels: [taskChannel.scope("workspace:live")],
  });

  const hub = createTaskLiveHub(tasks);
  const tracker = createTaskLiveTracker();
  const unsubscribe = await hub.subscribe({
    channels: [taskChannel.scope("workspace:live")],
    recentSteps: 10,
  }, (message) => {
    tracker.apply(message);
  });

  await waitForTaskToReachState(async () => {
    const state = tracker.getState();
    return state.snapshots.find((value) => value.taskId === queued.task.id)?.state;
  }, "succeeded");

  const state = tracker.getState();
  const snapshot = state.snapshots.find((value) => value.taskId === queued.task.id);

  expect(snapshot?.state).toBe("succeeded");
  expect(state.steps[queued.task.id]?.[0]?.message).toBe("phase one");
  expect(state.aggregate?.byState.succeeded).toBe(1);

  unsubscribe();
  await tasks.stop();
});

test("bridges bootstrap and normalized live updates through the socket helper", async () => {
  const store = new MemoryTaskStore();
  const tasks = createDemoTaskHost(store, "demo.socket", "socket phase", { ok: true });

  await tasks.start();
  const queued = await tasks.enqueue("demo.socket", { id: "socket" }, {
    channels: [taskChannel.scope("workspace:socket")],
  });

  const server = new FakeSocketServer();
  attachTaskLiveSocketBridge(server, {
    hub: createTaskLiveHub(tasks),
  });
  const socket = server.connect();
  socket.trigger("tasks:subscribe", {
    id: "panel",
    query: {
      taskIds: [queued.task.id],
      recentSteps: 10,
    },
  });

  await waitForSocketSuccessEvent(socket);

  const bootstrapMessage = socket.emitted.find((entry) => entry.event === "tasks:live");
  const succeededEvent = findSucceededSocketEvent(socket);

  expect((bootstrapMessage?.payload as { type?: string; id?: string })?.type).toBe("bootstrap");
  expect((bootstrapMessage?.payload as { type?: string; id?: string })?.id).toBe("panel");
  expect(succeededEvent).toBeDefined();

  await tasks.stop();
});
