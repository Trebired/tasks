import { describe, expect, test } from "bun:test";

import {
  createTaskHost,
  defineTaskHandler,
  createPostgresTaskStoreSchema,
} from "../../src/index.js";
import type {
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
  TaskRecord,
  TaskRetryInput,
  TaskStaleRequeueInput,
  TaskStepListQuery,
  TaskStepRecord,
  TaskStore,
  TaskSuccessInput,
  TaskUpdateProgressInput,
} from "../../src/types.js";

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
          };
        }
      }
    }

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
      attempt: 0,
      maxAttempts: input.maxAttempts,
      scheduledAt: input.scheduledAt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      claimedAt: null,
      startedAt: null,
      finishedAt: null,
      cancelRequestedAt: null,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
    };
    this.tasks.set(task.id, task);
    return {
      task,
      deduplicated: false,
    };
  }

  async getTask<TInput = unknown, TResult = unknown>(taskId: string): Promise<TaskRecord<TInput, TResult> | null> {
    return (this.tasks.get(taskId) || null) as TaskRecord<TInput, TResult> | null;
  }

  async listTasks<TInput = unknown, TResult = unknown>(_query?: TaskListQuery): Promise<TaskRecord<TInput, TResult>[]> {
    return [...this.tasks.values()] as TaskRecord<TInput, TResult>[];
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
    return task as TaskRecord<TInput, TResult>;
  }

  async markTaskRunning<TInput = unknown, TResult = unknown>(input: TaskLeaseInput): Promise<TaskRecord<TInput, TResult> | null> {
    const task = this.tasks.get(input.taskId);
    if (!task || task.leaseToken !== input.leaseToken) {
      return null;
    }
    task.status = "running";
    task.startedAt = task.startedAt || new Date().toISOString();
    return task as TaskRecord<TInput, TResult>;
  }

  async renewTaskLease<TInput = unknown, TResult = unknown>(input: TaskLeaseRenewalInput): Promise<TaskRecord<TInput, TResult> | null> {
    const task = this.tasks.get(input.taskId);
    if (!task || task.leaseToken !== input.leaseToken) {
      return null;
    }
    task.lastHeartbeatAt = new Date().toISOString();
    task.leaseExpiresAt = new Date(Date.now() + input.leaseMs).toISOString();
    return task as TaskRecord<TInput, TResult>;
  }

  async appendTaskStep(input: TaskAppendStepInput): Promise<TaskStepRecord | null> {
    const task = this.tasks.get(input.taskId);
    if (!task || task.leaseToken !== input.leaseToken) {
      return null;
    }
    const step: TaskStepRecord = {
      sequence: String(++this.sequence),
      taskId: input.taskId,
      attempt: input.attempt,
      kind: input.kind ?? "step",
      label: input.label,
      meta: input.meta ?? null,
      progressPercent: input.progressPercent ?? null,
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
    task.leaseOwner = null;
    task.leaseToken = null;
    return task as TaskRecord<TInput, TResult>;
  }

  async requeueStaleTasks(_input?: TaskStaleRequeueInput): Promise<number> {
    return 0;
  }
}

describe("@trebired/tasks", () => {
  test("runs a queued task and persists progress and steps", async () => {
    const store = new MemoryTaskStore();

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
            label: "Started unit of work",
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
    });

    await tasks.start();
    const queued = await tasks.enqueue("demo.run", {
      id: "demo",
    });

    for (let index = 0; index < 50; index += 1) {
      const task = await tasks.getTask(queued.task.id);
      if (task?.status === "succeeded") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const task = await tasks.getTask<{ id: string }, { ok: boolean }>(queued.task.id);
    const steps = await tasks.listTaskSteps(queued.task.id);

    expect(task?.status).toBe("succeeded");
    expect(task?.progressPercent).toBe(100);
    expect(task?.output?.ok).toBe(true);
    expect(steps).toHaveLength(1);

    await tasks.stop();
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
  });
});
