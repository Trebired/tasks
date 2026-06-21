import { describe, expect, test } from "bun:test";

import {
  attachTaskLiveSocketBridge,
  createPostgresTaskStoreSchema,
  createTaskHost,
  createTaskLiveHub,
  createTaskLiveTracker,
  defineTaskHandler,
  taskChannel,
} from "#8t8bq600b4wu";
import { buildTaskAggregateSnapshot, createTaskSnapshot } from "#ir9grtwyf3f1";
import type {
  TaskAggregateSnapshot,
  TaskAppendStepInput,
  TaskCancelInput,
  TaskCancelRunningInput,
  TaskClaimNextOptions,
  TaskCreateInput,
  TaskCreateResult,
  TaskExecutionHandle,
  TaskExecutor,
  TaskFailureInput,
  TaskLeaseInput,
  TaskLeaseRenewalInput,
  TaskListQuery,
  TaskMarkStaleInput,
  TaskRecord,
  TaskRetentionPolicy,
  TaskRetentionResult,
  TaskRetryInput,
  TaskStepListQuery,
  TaskStepRecord,
  TaskStore,
  TaskSuccessInput,
  TaskUpdateProgressInput,
} from "#2kjvrax0gr4m";

class MemoryTaskStore implements TaskStore {
  tasks = new Map<string, TaskRecord>();
  steps = new Map<string, TaskStepRecord[]>();
  sequence = 0;

  async createTask<TInput = unknown>(input: TaskCreateInput<TInput>): Promise<TaskCreateResult> {
    if (input.dedupeKey) {
      for (const task of this.tasks.values()) {
        if (task.kind === input.kind && task.dedupeKey === input.dedupeKey && ["queued", "claimed", "running"].includes(task.status)) {
          return {
            task,
            deduplicated: true,
            disposition: "reused",
            reusedTaskId: task.id,
            supersededTaskIds: [],
          };
        }
      }
    }

    const supersededTaskIds: string[] = [];
    if (input.supersedeExisting && input.supersedeKey) {
      for (const task of this.tasks.values()) {
        if (task.kind === input.kind && task.supersedeKey === input.supersedeKey && ["queued", "claimed", "running"].includes(task.status)) {
          task.status = "cancelled";
          task.finishedAt = new Date().toISOString();
          supersededTaskIds.push(task.id);
        }
      }
    }

    const createdAt = new Date().toISOString();
    const task: TaskRecord = {
      id: input.id,
      kind: input.kind,
      status: "queued",
      input: input.input,
      output: null,
      error: null,
      metadata: input.metadata ?? null,
      progressPercent: null,
      progressLabel: null,
      progressMeta: null,
      concurrencyKey: input.concurrencyKey ?? null,
      dedupeKey: input.dedupeKey ?? null,
      supersedeKey: input.supersedeKey ?? null,
      channels: input.channels ?? [],
      attempt: 0,
      maxAttempts: input.maxAttempts,
      scheduledAt: input.scheduledAt,
      createdAt,
      updatedAt: createdAt,
      claimedAt: null,
      startedAt: null,
      finishedAt: null,
      cancelRequestedAt: null,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      retryScheduledAt: null,
      staleAt: null,
      staleReason: null,
    };
    this.tasks.set(task.id, task);
    return {
      task,
      deduplicated: false,
      disposition: supersededTaskIds.length ? "superseded" : "created",
      reusedTaskId: null,
      supersededTaskIds,
    };
  }

  async getTask<TInput = unknown, TResult = unknown>(taskId: string): Promise<TaskRecord<TInput, TResult> | null> {
    return (this.tasks.get(taskId) || null) as TaskRecord<TInput, TResult> | null;
  }

  async listTasks<TInput = unknown, TResult = unknown>(query: TaskListQuery = {}): Promise<TaskRecord<TInput, TResult>[]> {
    let tasks = [...this.tasks.values()];
    if (query.taskIds?.length) {
      tasks = tasks.filter((task) => query.taskIds?.includes(task.id));
    }
    if (query.kinds?.length) {
      tasks = tasks.filter((task) => query.kinds?.includes(task.kind));
    }
    if (query.statuses?.length) {
      tasks = tasks.filter((task) => query.statuses?.includes(task.status));
    }
    if (query.channels?.length) {
      tasks = tasks.filter((task) => [...task.channels, taskChannel.task(task.id), taskChannel.kind(task.kind)].some((channel) => query.channels?.includes(channel)));
    }
    if (query.dedupeKey) {
      tasks = tasks.filter((task) => task.dedupeKey === query.dedupeKey);
    }
    if (query.concurrencyKey) {
      tasks = tasks.filter((task) => task.concurrencyKey === query.concurrencyKey);
    }
    if (query.supersedeKey) {
      tasks = tasks.filter((task) => task.supersedeKey === query.supersedeKey);
    }
    return tasks as TaskRecord<TInput, TResult>[];
  }

  async summarizeTasks(query: TaskListQuery = {}): Promise<TaskAggregateSnapshot> {
    const tasks = await this.listTasks(query);
    return buildTaskAggregateSnapshot(tasks.map((task) => createTaskSnapshot(task)));
  }

  async listTaskSteps(taskId: string, _query?: TaskStepListQuery): Promise<TaskStepRecord[]> {
    return this.steps.get(taskId) || [];
  }

  async findTaskByDedupeKey<TInput = unknown, TResult = unknown>(input): Promise<TaskRecord<TInput, TResult> | null> {
    for (const task of this.tasks.values()) {
      if (task.kind === input.kind && task.dedupeKey === input.dedupeKey) {
        return task as TaskRecord<TInput, TResult>;
      }
    }
    return null;
  }

  async claimNextTask<TInput = unknown, TResult = unknown>(input: TaskClaimNextOptions): Promise<TaskRecord<TInput, TResult> | null> {
    const task = [...this.tasks.values()].find((value) => value.status === "queued" && input.kinds.includes(value.kind));
    if (!task) {
      return null;
    }

    task.status = "claimed";
    task.attempt += 1;
    task.leaseOwner = input.runnerId;
    task.leaseToken = `${task.id}:${task.attempt}`;
    task.claimedAt = new Date().toISOString();
    task.updatedAt = task.claimedAt;
    task.leaseExpiresAt = new Date(Date.now() + input.leaseMs).toISOString();
    task.lastHeartbeatAt = task.claimedAt;
    task.staleAt = null;
    task.staleReason = null;
    return task as TaskRecord<TInput, TResult>;
  }

  async markTaskRunning<TInput = unknown, TResult = unknown>(input: TaskLeaseInput): Promise<TaskRecord<TInput, TResult> | null> {
    const task = this.tasks.get(input.taskId);
    if (!task || task.leaseToken !== input.leaseToken) {
      return null;
    }
    task.status = "running";
    task.startedAt = task.startedAt || new Date().toISOString();
    task.updatedAt = task.startedAt;
    task.staleAt = null;
    task.staleReason = null;
    return task as TaskRecord<TInput, TResult>;
  }

  async renewTaskLease<TInput = unknown, TResult = unknown>(input: TaskLeaseRenewalInput): Promise<TaskRecord<TInput, TResult> | null> {
    const task = this.tasks.get(input.taskId);
    if (!task || task.leaseToken !== input.leaseToken) {
      return null;
    }
    task.lastHeartbeatAt = new Date().toISOString();
    task.leaseExpiresAt = new Date(Date.now() + input.leaseMs).toISOString();
    task.updatedAt = task.lastHeartbeatAt;
    task.staleAt = null;
    task.staleReason = null;
    return task as TaskRecord<TInput, TResult>;
  }

  async appendTaskStep(input: TaskAppendStepInput): Promise<TaskStepRecord | null> {
    const task = this.tasks.get(input.taskId);
    if (!task || task.leaseToken !== input.leaseToken) {
      return null;
    }
    const step: TaskStepRecord = {
      id: String(++this.sequence),
      taskId: input.taskId,
      attempt: input.attempt,
      kind: input.kind ?? "step",
      level: input.level ?? "info",
      message: input.message || input.label || "step",
      meta: input.meta ?? null,
      percent: input.percent ?? input.progressPercent ?? null,
      createdAt: input.createdAt || new Date().toISOString(),
    };
    const current = this.steps.get(input.taskId) || [];
    current.push(step);
    this.steps.set(input.taskId, current);
    return step;
  }

  async updateTaskProgress<TInput = unknown, TResult = unknown>(input: TaskUpdateProgressInput): Promise<TaskRecord<TInput, TResult> | null> {
    const task = this.tasks.get(input.taskId);
    if (!task || task.leaseToken !== input.leaseToken) {
      return null;
    }
    task.progressPercent = input.percent ?? task.progressPercent;
    task.progressLabel = input.label ?? task.progressLabel;
    task.progressMeta = input.meta ?? task.progressMeta;
    task.updatedAt = input.updatedAt || new Date().toISOString();
    task.staleAt = null;
    task.staleReason = null;
    return task as TaskRecord<TInput, TResult>;
  }

  async markTaskSucceeded<TInput = unknown, TResult = unknown>(input: TaskSuccessInput<TResult>): Promise<TaskRecord<TInput, TResult> | null> {
    const task = this.tasks.get(input.taskId);
    if (!task || task.leaseToken !== input.leaseToken) {
      return null;
    }
    task.status = "succeeded";
    task.output = input.output;
    task.finishedAt = new Date().toISOString();
    task.progressPercent = 100;
    task.leaseOwner = null;
    task.leaseToken = null;
    task.retryScheduledAt = null;
    task.staleAt = null;
    task.staleReason = null;
    return task as TaskRecord<TInput, TResult>;
  }

  async markTaskFailed<TInput = unknown, TResult = unknown>(input: TaskFailureInput): Promise<TaskRecord<TInput, TResult> | null> {
    const task = this.tasks.get(input.taskId);
    if (!task || task.leaseToken !== input.leaseToken) {
      return null;
    }
    task.status = "failed";
    task.error = input.error;
    task.finishedAt = new Date().toISOString();
    task.leaseOwner = null;
    task.leaseToken = null;
    task.retryScheduledAt = null;
    return task as TaskRecord<TInput, TResult>;
  }

  async cancelTask<TInput = unknown, TResult = unknown>(input: TaskCancelInput): Promise<TaskRecord<TInput, TResult> | null> {
    const task = this.tasks.get(input.taskId);
    if (!task) {
      return null;
    }
    if (task.status === "queued") {
      task.status = "cancelled";
      task.finishedAt = new Date().toISOString();
    } else if (task.status === "claimed" || task.status === "running") {
      task.cancelRequestedAt = new Date().toISOString();
    }
    return task as TaskRecord<TInput, TResult>;
  }

  async markTaskCancelled<TInput = unknown, TResult = unknown>(input: TaskCancelRunningInput): Promise<TaskRecord<TInput, TResult> | null> {
    const task = this.tasks.get(input.taskId);
    if (!task || task.leaseToken !== input.leaseToken) {
      return null;
    }
    task.status = "cancelled";
    task.finishedAt = new Date().toISOString();
    task.leaseOwner = null;
    task.leaseToken = null;
    task.retryScheduledAt = null;
    return task as TaskRecord<TInput, TResult>;
  }

  async requeueTask<TInput = unknown, TResult = unknown>(input: TaskRetryInput): Promise<TaskRecord<TInput, TResult> | null> {
    const task = this.tasks.get(input.taskId);
    if (!task || task.leaseToken !== input.leaseToken) {
      return null;
    }
    task.status = "queued";
    task.error = input.error;
    task.scheduledAt = input.scheduledAt;
    task.retryScheduledAt = input.scheduledAt;
    task.leaseOwner = null;
    task.leaseToken = null;
    return task as TaskRecord<TInput, TResult>;
  }

  async markStaleTasks<TInput = unknown, TResult = unknown>(_input: TaskMarkStaleInput): Promise<TaskRecord<TInput, TResult>[]> {
    const current = _input.now || new Date().toISOString();
    const threshold = Date.parse(current) - _input.staleAfterMs;
    const stale: TaskRecord[] = [];

    for (const task of this.tasks.values()) {
      const reference = Date.parse(task.lastHeartbeatAt || task.updatedAt);
      if ((task.status === "claimed" || task.status === "running") && !task.staleAt && reference < threshold) {
        task.staleAt = current;
        task.staleReason = _input.reason || "Task became stale";
        task.updatedAt = current;
        stale.push(task);
      }
    }

    return stale as TaskRecord<TInput, TResult>[];
  }

  async requeueStaleTasks(): Promise<number> {
    return 0;
  }

  async applyRetentionPolicy(_policy: TaskRetentionPolicy): Promise<TaskRetentionResult> {
    return {
      deletedTasks: 0,
      deletedSteps: 0,
      compactedTasks: 0,
    };
  }
}

class FakeSocket {
  emitted: Array<{
    event: string;
    payload: unknown;
  }> = [];
  listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  emit(event: string, payload: unknown): void {
    this.emitted.push({
      event,
      payload,
    });
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    const current = this.listeners.get(event) || [];
    current.push(listener);
    this.listeners.set(event, current);
  }

  trigger(event: string, payload: unknown): void {
    for (const listener of this.listeners.get(event) || []) {
      listener(payload);
    }
  }
}

class FakeSocketServer {
  listener: ((socket: FakeSocket) => void) | null = null;

  on(_event: "connection", listener: (socket: FakeSocket) => void): void {
    this.listener = listener;
  }

  connect(): FakeSocket {
    const socket = new FakeSocket();
    this.listener?.(socket);
    return socket;
  }
}

describe("@trebired/tasks", () => {
  test("runs a queued task, exposes snapshots, and normalizes lifecycle events", async () => {
    const store = new MemoryTaskStore();
    const lifecycleEvents: string[] = [];

    const executor: TaskExecutor = {
      async execute(request): Promise<TaskExecutionHandle> {
        await request.onEvent?.({
          type: "progress",
          progress: {
            percent: 25,
            label: "working",
          },
        });

        await request.onEvent?.({
          type: "step",
          step: {
            message: "Started unit of work",
            level: "info",
            percent: 25,
          },
        });

        return {
          async cancel() {
            return;
          },
          completion: Promise.resolve({
            status: "succeeded",
            output: {
              ok: true,
            },
          }),
        };
      },
    };

    const tasks = createTaskHost({
      store,
      executor,
      handlers: [
        {
          kind: "demo.run",
          entrypoint: {
            module: new URL("../../examples/handlers/report_task.ts", import.meta.url),
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
    const queued = await tasks.enqueue("demo.run", {
      id: "demo",
    }, {
      channels: [
        taskChannel.scope("workspace:demo"),
      ],
    });

    for (let index = 0; index < 50; index += 1) {
      const task = await tasks.getTask(queued.task.id);
      if (task?.status === "succeeded") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

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

  test("bootstraps live state and tracks later updates", async () => {
    const store = new MemoryTaskStore();
    const executor: TaskExecutor = {
      async execute(request): Promise<TaskExecutionHandle> {
        await request.onEvent?.({
          type: "step",
          step: {
            message: "phase one",
            level: "info",
            percent: 50,
          },
        });

        return {
          async cancel() {
            return;
          },
          completion: new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                status: "succeeded",
                output: {
                  done: true,
                },
              });
            }, 25);
          }),
        };
      },
    };

    const tasks = createTaskHost({
      store,
      executor,
      handlers: [
        {
          kind: "demo.live",
          entrypoint: {
            module: new URL("../../examples/handlers/report_task.ts", import.meta.url),
          },
        },
      ],
      runner: {
        pollIntervalMs: 10,
        heartbeatMs: 20,
        leaseMs: 100,
        globalConcurrency: 1,
      },
    });

    await tasks.start();
    const queued = await tasks.enqueue("demo.live", {
      id: "live",
    }, {
      channels: [
        taskChannel.scope("workspace:live"),
      ],
    });

    const hub = createTaskLiveHub(tasks);
    const tracker = createTaskLiveTracker();
    const unsubscribe = await hub.subscribe({
      channels: [
        taskChannel.scope("workspace:live"),
      ],
      recentSteps: 10,
    }, (message) => {
      tracker.apply(message);
    });

    for (let index = 0; index < 50; index += 1) {
      const state = tracker.getState();
      const snapshot = state.snapshots.find((value) => value.taskId === queued.task.id);
      if (snapshot?.state === "succeeded") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const state = tracker.getState();
    const snapshot = state.snapshots.find((value) => value.taskId === queued.task.id);

    expect(snapshot?.state).toBe("succeeded");
    expect(state.steps[queued.task.id]?.[0]?.message).toBe("phase one");
    expect(state.aggregate?.byState.succeeded).toBe(1);

    unsubscribe();
    await tasks.stop();
  });

  test("filters bootstrap state by package-owned subscription keys and generic channels", async () => {
    const store = new MemoryTaskStore();
    const tasks = createTaskHost({
      store,
    });

    await tasks.enqueue("demo.filter", {
      id: "keep",
    }, {
      dedupeKey: "shared",
      concurrencyKey: "resource:42",
      channels: [
        taskChannel.scope("workspace:42"),
        taskChannel.resource("repo:42"),
        taskChannel.correlation("request:abc"),
        taskChannel.topic("imports"),
      ],
    });

    await tasks.enqueue("demo.filter", {
      id: "skip",
    }, {
      dedupeKey: "other",
      concurrencyKey: "resource:99",
      channels: [
        taskChannel.scope("workspace:99"),
        taskChannel.resource("repo:99"),
      ],
    });

    const bootstrap = await tasks.bootstrap({
      dedupeKey: "shared",
      concurrencyKey: "resource:42",
      channels: [
        taskChannel.resource("repo:42"),
      ],
    });

    expect(bootstrap.snapshots).toHaveLength(1);
    expect(bootstrap.snapshots[0]?.dedupeKey).toBe("shared");
    expect(bootstrap.snapshots[0]?.concurrencyKey).toBe("resource:42");
    expect(bootstrap.snapshots[0]?.channels.includes(taskChannel.topic("imports"))).toBe(true);
    expect(bootstrap.snapshots[0]?.channels.includes(taskChannel.correlation("request:abc"))).toBe(true);
  });

  test("bridges bootstrap and normalized live updates through the socket helper", async () => {
    const store = new MemoryTaskStore();
    const executor: TaskExecutor = {
      async execute(request): Promise<TaskExecutionHandle> {
        await request.onEvent?.({
          type: "step",
          step: {
            message: "socket phase",
            level: "info",
            percent: 50,
          },
        });

        return {
          async cancel() {
            return;
          },
          completion: new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                status: "succeeded",
                output: {
                  ok: true,
                },
              });
            }, 25);
          }),
        };
      },
    };

    const tasks = createTaskHost({
      store,
      executor,
      handlers: [
        {
          kind: "demo.socket",
          entrypoint: {
            module: new URL("../../examples/handlers/report_task.ts", import.meta.url),
          },
        },
      ],
      runner: {
        pollIntervalMs: 10,
        heartbeatMs: 20,
        leaseMs: 100,
        globalConcurrency: 1,
      },
    });

    await tasks.start();
    const queued = await tasks.enqueue("demo.socket", {
      id: "socket",
    }, {
      channels: [
        taskChannel.scope("workspace:socket"),
      ],
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

    for (let index = 0; index < 50; index += 1) {
      const delivered = socket.emitted.some((entry) => {
        if (entry.event !== "tasks:live" || typeof entry.payload !== "object" || !entry.payload) {
          return false;
        }

        const payload = entry.payload as {
          type?: string;
          event?: {
            event?: string;
          };
        };

        return payload.type === "event" && payload.event?.event === "succeeded";
      });

      if (delivered) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const bootstrapMessage = socket.emitted.find((entry) => entry.event === "tasks:live");
    const succeededEvent = socket.emitted.find((entry) => {
      if (entry.event !== "tasks:live" || typeof entry.payload !== "object" || !entry.payload) {
        return false;
      }

      const payload = entry.payload as {
        type?: string;
        event?: {
          event?: string;
        };
      };

      return payload.type === "event" && payload.event?.event === "succeeded";
    });

    expect((bootstrapMessage?.payload as {
      type?: string;
      id?: string;
    })?.type).toBe("bootstrap");
    expect((bootstrapMessage?.payload as {
      type?: string;
      id?: string;
    })?.id).toBe("panel");
    expect(succeededEvent).toBeDefined();

    await tasks.stop();
  });

  test("marks long-running work as stale through the package-owned stale model", async () => {
    const store = new MemoryTaskStore();
    const queued = await store.createTask({
      id: "stale-task",
      kind: "demo.stale",
      input: {
        id: "stale",
      },
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
    const tasks = createTaskHost({
      store,
    });

    const first = await tasks.enqueue("demo.dedupe", {
      id: 1,
    }, {
      dedupeKey: "same",
      supersedeKey: "same",
      channels: [
        taskChannel.scope("demo"),
      ],
    });

    const second = await tasks.enqueue("demo.dedupe", {
      id: 2,
    }, {
      dedupeKey: "same",
      channels: [
        taskChannel.scope("demo"),
      ],
    });

    const replacement = await tasks.enqueue("demo.replace", {
      id: 3,
    }, {
      supersedeKey: "replace",
    });

    const replaced = await tasks.enqueue("demo.replace", {
      id: 4,
    }, {
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
});
