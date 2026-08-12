import {
  createTaskHost,
  createTaskLiveHub,
  createTaskLiveTracker,
  taskChannel,
} from "#8t8bq600b4wu";
import {
  TaskAppendStepInput,
  TaskAggregateSnapshot,
  TaskClaimNextOptions,
  TaskCreateInput,
  TaskCreateResult,
  TaskFailureInput,
  TaskLeaseInput,
  TaskLeaseRenewalInput,
  TaskListQuery,
  TaskMarkStaleInput,
  TaskRecord,
  TaskRetentionPolicy,
  TaskRetentionResult,
  TaskStepListQuery,
  TaskStepRecord,
  TaskStore,
  TaskSuccessInput,
  TaskUpdateProgressInput,
} from "#2kjvrax0gr4m";
import { emitLiveDemoEvents } from "./demo/events.js";
import { subscribeToDemoUpdates } from "./demo/subscription.js";

type DemoTaskStatus = TaskRecord["status"];
type DemoTaskStatusCounts = Record<DemoTaskStatus, number>;

async function missingMemoryTask<TInput=unknown, TResult=unknown>(): Promise<
TaskRecord<TInput, TResult>|null
> {
  return null;
}

function countDemoTasksByStatus(tasks: TaskRecord[], status: DemoTaskStatus): number {
  return tasks.filter((task) => task.status === status).length;
}

function countDemoTasksByKind(tasks: TaskRecord[], kind: string): number {
  return tasks.filter((task) => task.kind === kind).length;
}

function createDemoTaskStatusCounts(tasks: TaskRecord[]): DemoTaskStatusCounts {
  return {
    queued: countDemoTasksByStatus(tasks, "queued"),
    claimed: countDemoTasksByStatus(tasks, "claimed"),
    running: countDemoTasksByStatus(tasks, "running"),
    succeeded: countDemoTasksByStatus(tasks, "succeeded"),
    failed: countDemoTasksByStatus(tasks, "failed"),
    cancelled: countDemoTasksByStatus(tasks, "cancelled"),
  };
}

function createDemoTaskStatusSummary(tasks: TaskRecord[]): Pick<
TaskAggregateSnapshot,
"byState" | "byStatus"
> {
  const counts = createDemoTaskStatusCounts(tasks);

  return {
    byState: {
      ...counts,
      retrying: 0,
      stale: 0,
    },
    byStatus: counts,
  };
}

class MemoryTaskStore implements TaskStore {
  tasks = new Map<string, TaskRecord>();
  steps = new Map<string, TaskStepRecord[]>();
  stepId = 0;
  findTaskByDedupeKey: TaskStore["findTaskByDedupeKey"] = missingMemoryTask;
  cancelTask: TaskStore["cancelTask"] = missingMemoryTask;
  markTaskCancelled: TaskStore["markTaskCancelled"] = missingMemoryTask;
  requeueTask: TaskStore["requeueTask"] = missingMemoryTask;

  private taskValues(): TaskRecord[] {
    return [...this.tasks.values()];
  }

  async createTask<TInput=unknown>(
    input: TaskCreateInput<TInput>,
  ): Promise<TaskCreateResult> {
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
      disposition: "created",
      reusedTaskId: null,
      supersededTaskIds: [],
    };
  }

  async getTask<TInput=unknown, TResult=unknown>(
    taskId: string,
  ): Promise<TaskRecord<TInput, TResult>|null> {
    return (this.tasks.get(taskId) || null) as TaskRecord<
    TInput,
    TResult
    >|null;
  }

  async listTasks<TInput=unknown, TResult=unknown>(
    _query?: TaskListQuery,
  ): Promise<TaskRecord<TInput, TResult>[]> {
    return this.taskValues() as TaskRecord<TInput, TResult>[];
  }

  async summarizeTasks(_query?: TaskListQuery): Promise<TaskAggregateSnapshot> {
    const tasks = this.taskValues();

    return {
      total: tasks.length,
      ...createDemoTaskStatusSummary(tasks),
      byKind: {
        "report.generate": countDemoTasksByKind(tasks, "report.generate"),
      },
      updatedAt: new Date().toISOString(),
    };
  }

  async listTaskSteps(
    taskId: string,
    _query?: TaskStepListQuery,
  ): Promise<TaskStepRecord[]> {
    return this.steps.get(taskId) || [];
  }

  async claimNextTask<TInput=unknown, TResult=unknown>(
    input: TaskClaimNextOptions,
  ): Promise<TaskRecord<TInput, TResult>|null> {
    const task = this.taskValues().find(
      (value) => value.status === "queued" && input.kinds.includes(value.kind),
    );
    if (!task) {
      return null;
    }

    task.status = "claimed";
    task.attempt += 1;
    task.leaseOwner = input.runnerId;
    task.leaseToken = `${task.id}:${task.attempt}`;
    task.claimedAt = new Date().toISOString();
    task.updatedAt = task.claimedAt;
    return task as TaskRecord<TInput, TResult>;
  }

  async markTaskRunning<TInput=unknown, TResult=unknown>(
    input: TaskLeaseInput,
  ): Promise<TaskRecord<TInput, TResult>|null> {
    const task = this.tasks.get(input.taskId);
    if (!task) {
      return null;
    }
    task.status = "running";
    task.startedAt = new Date().toISOString();
    task.updatedAt = task.startedAt;
    return task as TaskRecord<TInput, TResult>;
  }

  async renewTaskLease<TInput=unknown, TResult=unknown>(
    input: TaskLeaseRenewalInput,
  ): Promise<TaskRecord<TInput, TResult>|null> {
    const task = this.tasks.get(input.taskId);
    if (!task) {
      return null;
    }
    task.lastHeartbeatAt = new Date().toISOString();
    task.updatedAt = task.lastHeartbeatAt;
    return task as TaskRecord<TInput, TResult>;
  }

  async appendTaskStep(
    input: TaskAppendStepInput,
  ): Promise<TaskStepRecord|null> {
    const step: TaskStepRecord = {
      id: String(++this.stepId),
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

  async updateTaskProgress<TInput=unknown, TResult=unknown>(
    input: TaskUpdateProgressInput,
  ): Promise<TaskRecord<TInput, TResult>|null> {
    const task = this.tasks.get(input.taskId);
    if (!task) {
      return null;
    }
    task.progressPercent = input.percent ?? task.progressPercent;
    task.progressLabel = input.label ?? task.progressLabel;
    task.progressMeta = input.meta ?? task.progressMeta;
    task.updatedAt = input.updatedAt || new Date().toISOString();
    return task as TaskRecord<TInput, TResult>;
  }

  async markTaskSucceeded<TInput=unknown, TResult=unknown>(
    input: TaskSuccessInput<TResult>,
  ): Promise<TaskRecord<TInput, TResult>|null> {
    const task = this.tasks.get(input.taskId);
    if (!task) {
      return null;
    }
    task.status = "succeeded";
    task.output = input.output;
    task.progressPercent = 100;
    task.finishedAt = new Date().toISOString();
    return task as TaskRecord<TInput, TResult>;
  }

  async markTaskFailed<TInput=unknown, TResult=unknown>(
    input: TaskFailureInput,
  ): Promise<TaskRecord<TInput, TResult>|null> {
    const task = this.tasks.get(input.taskId);
    if (!task) {
      return null;
    }
    task.status = "failed";
    task.error = input.error;
    task.finishedAt = new Date().toISOString();
    return task as TaskRecord<TInput, TResult>;
  }

  async markStaleTasks<TInput=unknown, TResult=unknown>(
    _input: TaskMarkStaleInput,
  ): Promise<TaskRecord<TInput, TResult>[]> {
    return [];
  }

  async requeueStaleTasks() {
    return 0;
  }

  async applyRetentionPolicy(
    _policy: TaskRetentionPolicy,
  ): Promise<TaskRetentionResult> {
    return {
      deletedTasks: 0,
      deletedSteps: 0,
      compactedTasks: 0,
    };
  }
}

function createLiveDemoHost(store: MemoryTaskStore) {
  return createTaskHost({
      store,
      executor: {
        async execute(request) {
          await emitLiveDemoEvents(request);
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
      },
      handlers: [
        {
          kind: "report.generate",
          entrypoint: {
            module: new URL("./handlers/report_task.ts", import.meta.url),
          },
        },
      ],
  });
}

async function main() {
  const store = new MemoryTaskStore();
  const host = createLiveDemoHost(store);
  const hub = createTaskLiveHub(host);
  const tracker = createTaskLiveTracker();

  await subscribeToDemoUpdates(hub, tracker);
  await host.start();
  await host.enqueue(
    "report.generate",
    {
      reportId: "rpt_live",
    },
    {
      channels: [taskChannel.scope("workspace:demo")],
    },
  );
}

void main();
