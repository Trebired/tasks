import { resolveLogger } from "@trebired/logger-adapter";

import {
  DEFAULT_TASK_GLOBAL_CONCURRENCY,
  DEFAULT_TASK_HEARTBEAT_MS,
  DEFAULT_TASK_LEASE_MS,
  DEFAULT_TASK_MAX_ATTEMPTS,
  DEFAULT_TASK_POLL_INTERVAL_MS,
  DEFAULT_TASK_STALE_SCAN_INTERVAL_MS,
  DEFAULT_TASK_STALE_SCAN_LIMIT,
  DEFAULT_TASK_STOP_TIMEOUT_MS,
  TASKS_LOG_GROUP,
} from "#5dtdwzlie8fm";
import type {
  TaskAggregateSnapshot,
  TaskEnqueueOptions,
  TaskEnqueueResult,
  TaskExecutionHandle,
  TaskExecutor,
  TaskExecutorOutcome,
  TaskHandlerRegistration,
  TaskHost,
  TaskHostEvent,
  TaskHostEventListener,
  TaskHostOptions,
  TaskHostState,
  TaskLifecycleEventListener,
  TaskRecord,
  TaskRetentionPolicy,
  TaskRetentionResult,
  TaskSnapshot,
  TaskSnapshotQuery,
  TaskStepRecord,
  TaskSubscriptionBootstrap,
  TaskSubscriptionQuery,
  TaskTerminalError,
} from "#2kjvrax0gr4m";
import { createChildProcessTaskExecutor } from "../executor/child_process.js";
import { normalizeTaskHostEvent } from "./lifecycle.js";
import { buildTaskAggregateSnapshot, createTaskSnapshot, matchesTaskQuery } from "./snapshot.js";
import { TaskEventEmitter } from "./emitter.js";
import { resolveRetryDecision } from "./retry.js";
import { clampPercent, nowIso, sleep, taskId, toErrorShape, withTimeout } from "./utils.js";

type RunningExecution = {
  taskId: string;
  task: TaskRecord;
  handle: TaskExecutionHandle;
  cancelRequested: boolean;
  heartbeatTimer: NodeJS.Timeout | null;
  settled: Promise<void>;
};

class TaskHostRuntime implements TaskHost {
  #store: TaskHostOptions["store"];
  #executor: TaskExecutor;
  #handlers = new Map<string, TaskHandlerRegistration>();
  #eventEmitter = new TaskEventEmitter<TaskHostEventListener>();
  #lifecycleEmitter = new TaskEventEmitter<TaskLifecycleEventListener>();
  #logger;
  #state: TaskHostState = "idle";
  #runnerId: string;
  #pollIntervalMs: number;
  #heartbeatMs: number;
  #leaseMs: number;
  #globalConcurrency: number;
  #staleScanIntervalMs: number;
  #staleScanLimit: number;
  #watchdogMs: number;
  #watchdogScanIntervalMs: number;
  #retentionPolicy: TaskRetentionPolicy | null;
  #retentionScanIntervalMs: number;
  #stopTimeoutMs: number;
  #defaultMaxAttempts: number;
  #pumpPromise: Promise<void> | null = null;
  #pollTimer: NodeJS.Timeout | null = null;
  #staleTimer: NodeJS.Timeout | null = null;
  #watchdogTimer: NodeJS.Timeout | null = null;
  #retentionTimer: NodeJS.Timeout | null = null;
  #running = new Map<string, RunningExecution>();

  constructor(options: TaskHostOptions) {
    this.#store = options.store;
    this.#executor = options.executor ?? createChildProcessTaskExecutor();
    this.#runnerId = options.runner?.id || taskId();
    this.#pollIntervalMs = Math.max(50, options.runner?.pollIntervalMs ?? DEFAULT_TASK_POLL_INTERVAL_MS);
    this.#heartbeatMs = Math.max(500, options.runner?.heartbeatMs ?? DEFAULT_TASK_HEARTBEAT_MS);
    this.#leaseMs = Math.max(this.#heartbeatMs * 2, options.runner?.leaseMs ?? DEFAULT_TASK_LEASE_MS);
    this.#globalConcurrency = Math.max(1, options.runner?.globalConcurrency ?? DEFAULT_TASK_GLOBAL_CONCURRENCY);
    this.#staleScanIntervalMs = Math.max(1_000, options.runner?.staleScanIntervalMs ?? DEFAULT_TASK_STALE_SCAN_INTERVAL_MS);
    this.#staleScanLimit = Math.max(1, options.runner?.staleScanLimit ?? DEFAULT_TASK_STALE_SCAN_LIMIT);
    this.#watchdogMs = Math.max(0, options.runner?.watchdogMs ?? 0);
    this.#watchdogScanIntervalMs = Math.max(1_000, options.runner?.watchdogScanIntervalMs ?? this.#staleScanIntervalMs);
    this.#retentionPolicy = options.runner?.retentionPolicy ?? null;
    this.#retentionScanIntervalMs = Math.max(1_000, options.runner?.retentionScanIntervalMs ?? 60_000);
    this.#stopTimeoutMs = Math.max(1_000, options.runner?.stopTimeoutMs ?? DEFAULT_TASK_STOP_TIMEOUT_MS);
    this.#defaultMaxAttempts = Math.max(1, options.defaultMaxAttempts ?? DEFAULT_TASK_MAX_ATTEMPTS);
    this.#logger = resolveLogger({
      logger: options.logger,
      adapter: options.loggerAdapter,
      source: TASKS_LOG_GROUP,
    });

    for (const handler of options.handlers || []) {
      this.registerHandler(handler);
    }

    if (options.onEvent) {
      this.onEvent(options.onEvent);
    }

    if (options.onLifecycleEvent) {
      this.onLifecycleEvent(options.onLifecycleEvent);
    }
  }

  getState(): TaskHostState {
    return this.#state;
  }

  registerHandler(handler: TaskHandlerRegistration): TaskHost {
    this.#handlers.set(handler.kind, handler);
    return this;
  }

  async enqueue<TInput = unknown>(kind: string, input: TInput, options: TaskEnqueueOptions = {}): Promise<TaskEnqueueResult> {
    const handler = this.#handlers.get(kind);
    const maxAttempts = Math.max(
      1,
      options.maxAttempts
        ?? handler?.retry?.maxAttempts
        ?? this.#defaultMaxAttempts,
    );

    const result = await this.#store.createTask({
      id: taskId(options.id),
      kind,
      input,
      metadata: options.metadata ?? handler?.metadata ?? null,
      concurrencyKey: options.concurrencyKey ?? null,
      dedupeKey: options.dedupeKey ?? null,
      supersedeKey: options.supersedeKey ?? null,
      supersedeExisting: options.supersedeExisting ?? false,
      channels: options.channels ?? null,
      maxAttempts,
      scheduledAt: nowIso(options.scheduledAt),
    });

    this.#emit({
      type: "task:enqueued",
      timestamp: nowIso(),
      runnerId: this.#runnerId,
      taskId: result.task.id,
      kind: result.task.kind,
      task: result.task,
      deduplicated: result.deduplicated,
      disposition: result.disposition,
      supersededTaskIds: result.supersededTaskIds,
    });

    void this.#schedulePump();
    return result;
  }

  async getTask<TInput = unknown, TResult = unknown>(taskIdValue: string): Promise<TaskRecord<TInput, TResult> | null> {
    return this.#store.getTask(taskIdValue) as Promise<TaskRecord<TInput, TResult> | null>;
  }

  async listTasks<TInput = unknown, TResult = unknown>(query?) {
    return this.#store.listTasks(query) as Promise<TaskRecord<TInput, TResult>[]>;
  }

  async listTaskSteps(taskIdValue: string, query?) {
    return this.#store.listTaskSteps(taskIdValue, query);
  }

  async readSnapshot<TInput = unknown, TResult = unknown>(taskIdValue: string, options: {
    includeSteps?: number | null;
  } = {}): Promise<(TaskSnapshot<TInput, TResult> & {
    steps?: TaskStepRecord[];
  }) | null> {
    const task = await this.getTask<TInput, TResult>(taskIdValue);
    if (!task) {
      return null;
    }

    const snapshot = createTaskSnapshot(task);
    const steps = typeof options.includeSteps === "number" && options.includeSteps > 0
      ? await this.#store.listTaskSteps(taskIdValue, {
        limit: options.includeSteps,
      })
      : undefined;

    return steps ? {
      ...snapshot,
      steps,
    } : snapshot;
  }

  async listSnapshots<TInput = unknown, TResult = unknown>(query: TaskSnapshotQuery = {}): Promise<Array<TaskSnapshot<TInput, TResult> & {
    steps?: TaskStepRecord[];
  }>> {
    const tasks = await this.#store.listTasks<TInput, TResult>({
      taskIds: query.taskIds,
      kinds: query.kinds,
      statuses: query.statuses,
      channels: query.channels,
      concurrencyKey: query.concurrencyKey,
      dedupeKey: query.dedupeKey,
      supersedeKey: query.supersedeKey,
      limit: query.limit,
      offset: query.offset,
      orderBy: query.orderBy,
    });

    const filtered = tasks
      .map((task) => createTaskSnapshot(task))
      .filter((snapshot) => matchesTaskQuery(snapshot, query));

    const withSteps = typeof query.includeSteps === "number" && query.includeSteps > 0
      ? await Promise.all(filtered.map(async (snapshot) => ({
        ...snapshot,
        steps: await this.#store.listTaskSteps(snapshot.taskId, {
          limit: query.includeSteps || undefined,
        }),
      })))
      : filtered;

    return withSteps as Array<TaskSnapshot<TInput, TResult> & {
      steps?: TaskStepRecord[];
    }>;
  }

  async readAggregate(query: TaskSnapshotQuery = {}): Promise<TaskAggregateSnapshot> {
    const base = await this.#store.summarizeTasks({
      taskIds: query.taskIds,
      kinds: query.kinds,
      statuses: query.statuses,
      channels: query.channels,
      concurrencyKey: query.concurrencyKey,
      dedupeKey: query.dedupeKey,
      supersedeKey: query.supersedeKey,
      limit: query.limit,
      offset: query.offset,
      orderBy: query.orderBy,
    });

    if (!query.states?.length) {
      return base;
    }

    const snapshots = await this.listSnapshots(query);
    return buildTaskAggregateSnapshot(snapshots);
  }

  async bootstrap(query: TaskSubscriptionQuery = {}): Promise<TaskSubscriptionBootstrap> {
    const snapshots = await this.listSnapshots({
      taskIds: query.taskIds,
      kinds: query.kinds,
      statuses: query.statuses,
      channels: query.channels,
      states: query.states,
      limit: query.limit,
    });

    const steps = typeof query.recentSteps === "number" && query.recentSteps > 0
      ? Object.fromEntries(await Promise.all(snapshots.map(async (snapshot) => [
        snapshot.taskId,
        await this.#store.listTaskSteps(snapshot.taskId, {
          limit: query.recentSteps || undefined,
        }),
      ] as const)))
      : {};

    return {
      type: "bootstrap",
      timestamp: nowIso(),
      query,
      snapshots,
      steps,
      aggregate: query.includeAggregate === false
        ? null
        : buildTaskAggregateSnapshot(snapshots),
    };
  }

  async compact(policy?: TaskRetentionPolicy | null): Promise<TaskRetentionResult> {
    const resolved = policy ?? this.#retentionPolicy;
    if (!resolved) {
      return {
        deletedTasks: 0,
        deletedSteps: 0,
        compactedTasks: 0,
      };
    }

    return this.#store.applyRetentionPolicy(resolved);
  }

  async cancel(taskIdValue: string, reason?: string): Promise<TaskRecord | null> {
    const task = await this.#store.cancelTask({
      taskId: taskIdValue,
      reason,
      requestedAt: nowIso(),
    });

    const running = task ? this.#running.get(task.id) : null;
    if (running) {
      running.cancelRequested = true;
      await running.handle.cancel(reason || "Task cancelled");
    }

    if (task && task.status === "cancelled") {
      this.#emit({
        type: "task:cancelled",
        timestamp: nowIso(),
        runnerId: this.#runnerId,
        taskId: task.id,
        kind: task.kind,
        task,
      });
    }

    return task;
  }

  onEvent(listener: TaskHostEventListener): () => void {
    return this.#eventEmitter.add(listener);
  }

  onLifecycleEvent(listener: TaskLifecycleEventListener): () => void {
    return this.#lifecycleEmitter.add(listener);
  }

  async start(): Promise<void> {
    if (this.#state === "running") {
      return;
    }

    if (this.#state === "stopping") {
      await this.stop();
    }

    this.#state = "running";
    this.#emit({
      type: "runner:start",
      timestamp: nowIso(),
      runnerId: this.#runnerId,
    });

    this.#logger.info(TASKS_LOG_GROUP, "task runner started", {
      runnerId: this.#runnerId,
      concurrency: this.#globalConcurrency,
    });

    await this.#recoverStaleLeases();
    await this.#markWatchdogStale();

    this.#pollTimer = setInterval(() => {
      void this.#schedulePump();
    }, this.#pollIntervalMs);
    this.#pollTimer.unref?.();

    this.#staleTimer = setInterval(() => {
      void this.#recoverStaleLeases();
    }, this.#staleScanIntervalMs);
    this.#staleTimer.unref?.();

    if (this.#watchdogMs > 0) {
      this.#watchdogTimer = setInterval(() => {
        void this.#markWatchdogStale();
      }, this.#watchdogScanIntervalMs);
      this.#watchdogTimer.unref?.();
    }

    if (this.#retentionPolicy) {
      this.#retentionTimer = setInterval(() => {
        void this.compact();
      }, this.#retentionScanIntervalMs);
      this.#retentionTimer.unref?.();
    }

    await this.#schedulePump();
  }

  async stop(): Promise<void> {
    if (this.#state === "idle" || this.#state === "stopped") {
      this.#state = "stopped";
      return;
    }

    if (this.#state === "stopping") {
      await this.#waitForRunning();
      this.#state = "stopped";
      return;
    }

    this.#state = "stopping";

    for (const timer of [this.#pollTimer, this.#staleTimer, this.#watchdogTimer, this.#retentionTimer]) {
      if (timer) {
        clearInterval(timer);
      }
    }

    this.#pollTimer = null;
    this.#staleTimer = null;
    this.#watchdogTimer = null;
    this.#retentionTimer = null;

    if (this.#pumpPromise) {
      await this.#pumpPromise;
    }

    try {
      await withTimeout(this.#waitForRunning(), this.#stopTimeoutMs);
    } catch {
      for (const execution of this.#running.values()) {
        await execution.handle.cancel("Task runner stopping");
      }
      await this.#waitForRunning();
    }

    this.#state = "stopped";
    this.#emit({
      type: "runner:stop",
      timestamp: nowIso(),
      runnerId: this.#runnerId,
    });
  }

  async #recoverStaleLeases(): Promise<void> {
    const recovered = await this.#store.requeueStaleTasks({
      limit: this.#staleScanLimit,
      now: nowIso(),
    });

    if (recovered > 0) {
      this.#emit({
        type: "task:stale_requeued",
        timestamp: nowIso(),
        runnerId: this.#runnerId,
        count: recovered,
      });
      void this.#schedulePump();
    }
  }

  async #markWatchdogStale(): Promise<void> {
    if (this.#watchdogMs <= 0) {
      return;
    }

    const stale = await this.#store.markStaleTasks({
      staleAfterMs: this.#watchdogMs,
      limit: this.#staleScanLimit,
      now: nowIso(),
      reason: "Task stopped reporting progress or heartbeat",
    });

    for (const task of stale) {
      this.#emit({
        type: "task:stale",
        timestamp: nowIso(),
        runnerId: this.#runnerId,
        taskId: task.id,
        kind: task.kind,
        task,
      });
    }
  }

  async #schedulePump(): Promise<void> {
    if (this.#state !== "running" || this.#pumpPromise) {
      return;
    }

    this.#pumpPromise = this.#pump().finally(() => {
      this.#pumpPromise = null;
    });

    await this.#pumpPromise;
  }

  async #pump(): Promise<void> {
    while (this.#state === "running" && this.#running.size < this.#globalConcurrency) {
      const task = await this.#store.claimNextTask({
        runnerId: this.#runnerId,
        leaseMs: this.#leaseMs,
        kinds: [...this.#handlers.keys()],
        globalConcurrency: this.#globalConcurrency,
        perKindConcurrency: this.#perKindConcurrency(),
        now: nowIso(),
      });

      if (!task) {
        return;
      }

      const handler = this.#handlers.get(task.kind);
      if (!handler || !task.leaseToken) {
        const error = toErrorShape(`No handler registered for task kind "${task.kind}"`);
        await this.#store.markTaskFailed({
          taskId: task.id,
          runnerId: this.#runnerId,
          leaseToken: task.leaseToken || "",
          error,
          finishedAt: nowIso(),
        });
        continue;
      }

      this.#emit({
        type: "task:claimed",
        timestamp: nowIso(),
        runnerId: this.#runnerId,
        taskId: task.id,
        kind: task.kind,
        task,
      });

      void this.#startExecution(task, handler);
    }
  }

  #perKindConcurrency(): Record<string, number | undefined> {
    const limits: Record<string, number | undefined> = {};
    for (const [kind, handler] of this.#handlers) {
      limits[kind] = handler.concurrency?.limit;
    }
    return limits;
  }

  async #startExecution(task: TaskRecord, handler: TaskHandlerRegistration): Promise<void> {
    if (!task.leaseToken) {
      return;
    }

    const runningTask = await this.#store.markTaskRunning({
      taskId: task.id,
      runnerId: this.#runnerId,
      leaseToken: task.leaseToken,
    });

    const currentTask = runningTask || task;
    this.#emit({
      type: "task:running",
      timestamp: nowIso(),
      runnerId: this.#runnerId,
      taskId: currentTask.id,
      kind: currentTask.kind,
      task: currentTask,
    });

    const controller = new AbortController();
    let executionHandle: TaskExecutionHandle;
    try {
      executionHandle = await this.#executor.execute({
        task: currentTask,
        handler,
        signal: controller.signal,
        onEvent: async (event) => {
          if (event.type === "progress") {
            const updated = await this.#store.updateTaskProgress({
              taskId: currentTask.id,
              runnerId: this.#runnerId,
              leaseToken: currentTask.leaseToken || "",
              percent: clampPercent(event.progress.percent),
              label: event.progress.label ?? null,
              meta: event.progress.meta ?? null,
              updatedAt: nowIso(),
            });

            if (updated) {
              currentTask.progressPercent = updated.progressPercent;
              currentTask.progressLabel = updated.progressLabel;
              currentTask.progressMeta = updated.progressMeta;
              currentTask.updatedAt = updated.updatedAt;
              currentTask.staleAt = updated.staleAt;
              currentTask.staleReason = updated.staleReason;
            }

            this.#emit({
              type: "task:progress",
              timestamp: nowIso(),
              runnerId: this.#runnerId,
              taskId: currentTask.id,
              kind: currentTask.kind,
              task: updated || currentTask,
            });
            return;
          }

          const step = await this.#store.appendTaskStep({
            taskId: currentTask.id,
            runnerId: this.#runnerId,
            leaseToken: currentTask.leaseToken || "",
            attempt: currentTask.attempt,
            kind: event.step.kind ?? "step",
            level: event.step.level ?? "info",
            message: event.step.message || event.step.label || "step",
            meta: event.step.meta ?? null,
            percent: event.step.percent ?? event.step.progressPercent ?? null,
            createdAt: nowIso(),
          });

          const progressPercent = event.step.percent ?? event.step.progressPercent;
          if (progressPercent != null) {
            const updated = await this.#store.updateTaskProgress({
              taskId: currentTask.id,
              runnerId: this.#runnerId,
              leaseToken: currentTask.leaseToken || "",
              percent: progressPercent,
              updatedAt: nowIso(),
            });
            if (updated) {
              currentTask.progressPercent = updated.progressPercent;
              currentTask.updatedAt = updated.updatedAt;
            }
          }

          this.#emit({
            type: "task:step",
            timestamp: nowIso(),
            runnerId: this.#runnerId,
            taskId: currentTask.id,
            kind: currentTask.kind,
            task: currentTask,
            step,
          });
        },
      });
    } catch (error) {
      const failed = await this.#store.markTaskFailed({
        taskId: currentTask.id,
        runnerId: this.#runnerId,
        leaseToken: currentTask.leaseToken || "",
        error: toErrorShape(error),
        finishedAt: nowIso(),
      });
      this.#emit({
        type: "task:failed",
        timestamp: nowIso(),
        runnerId: this.#runnerId,
        taskId: currentTask.id,
        kind: currentTask.kind,
        task: failed,
        error,
      });
      void this.#schedulePump();
      return;
    }

    const running: RunningExecution = {
      taskId: currentTask.id,
      task: currentTask,
      handle: executionHandle,
      cancelRequested: Boolean(currentTask.cancelRequestedAt),
      heartbeatTimer: null,
      settled: Promise.resolve(),
    };

    this.#running.set(currentTask.id, running);
    running.heartbeatTimer = setInterval(() => {
      void this.#heartbeat(running);
    }, this.#heartbeatMs);
    running.heartbeatTimer.unref?.();

    running.settled = this.#settleExecution(running, handler);
    await running.settled;
  }

  async #heartbeat(running: RunningExecution): Promise<void> {
    const renewed = await this.#store.renewTaskLease({
      taskId: running.taskId,
      runnerId: this.#runnerId,
      leaseToken: running.task.leaseToken || "",
      leaseMs: this.#leaseMs,
      now: nowIso(),
    });

    if (!renewed) {
      if (running.heartbeatTimer) {
        clearInterval(running.heartbeatTimer);
        running.heartbeatTimer = null;
      }
      await running.handle.cancel("Task lease lost");
      this.#emit({
        type: "task:lease_lost",
        timestamp: nowIso(),
        runnerId: this.#runnerId,
        taskId: running.task.id,
        kind: running.task.kind,
        task: running.task,
      });
      return;
    }

    running.task = renewed;
    if (renewed.cancelRequestedAt && !running.cancelRequested) {
      running.cancelRequested = true;
      await running.handle.cancel("Task cancellation requested");
    }
  }

  async #settleExecution(running: RunningExecution, handler: TaskHandlerRegistration): Promise<void> {
    let outcome: TaskExecutorOutcome;
    try {
      outcome = await running.handle.completion;
    } catch (error) {
      outcome = {
        status: running.cancelRequested ? "cancelled" : "failed",
        error: toErrorShape(error),
      };
    } finally {
      if (running.heartbeatTimer) {
        clearInterval(running.heartbeatTimer);
      }
    }

    try {
      if (outcome.status === "succeeded") {
        const task = await this.#store.markTaskSucceeded({
          taskId: running.task.id,
          runnerId: this.#runnerId,
          leaseToken: running.task.leaseToken || "",
          output: outcome.output,
          finishedAt: nowIso(),
        });
        this.#emit({
          type: "task:succeeded",
          timestamp: nowIso(),
          runnerId: this.#runnerId,
          taskId: running.task.id,
          kind: running.task.kind,
          task,
          output: outcome.output,
        });
        return;
      }

      if (outcome.status === "cancelled" || running.cancelRequested) {
        const task = await this.#store.markTaskCancelled({
          taskId: running.task.id,
          runnerId: this.#runnerId,
          leaseToken: running.task.leaseToken || "",
          reason: outcome.error?.message || "Task cancelled",
          finishedAt: nowIso(),
        });
        this.#emit({
          type: "task:cancelled",
          timestamp: nowIso(),
          runnerId: this.#runnerId,
          taskId: running.task.id,
          kind: running.task.kind,
          task,
        });
        return;
      }

      const error = outcome.error || toErrorShape("Task failed");
      const retry = await resolveRetryDecision({
        task: running.task,
        handler,
        error,
        defaultMaxAttempts: this.#defaultMaxAttempts,
      });

      if (retry.retry && retry.scheduledAt) {
        const task = await this.#store.requeueTask({
          taskId: running.task.id,
          runnerId: this.#runnerId,
          leaseToken: running.task.leaseToken || "",
          error,
          scheduledAt: nowIso(retry.scheduledAt),
        });
        this.#emit({
          type: "task:retry",
          timestamp: nowIso(),
          runnerId: this.#runnerId,
          taskId: running.task.id,
          kind: running.task.kind,
          task,
          error,
        });
        return;
      }

      const task = await this.#store.markTaskFailed({
        taskId: running.task.id,
        runnerId: this.#runnerId,
        leaseToken: running.task.leaseToken || "",
        error,
        finishedAt: nowIso(),
      });
      this.#emit({
        type: "task:failed",
        timestamp: nowIso(),
        runnerId: this.#runnerId,
        taskId: running.task.id,
        kind: running.task.kind,
        task,
        error,
      });
    } finally {
      this.#running.delete(running.taskId);
      if (this.#state === "running") {
        void this.#schedulePump();
      }
    }
  }

  async #waitForRunning(): Promise<void> {
    while (this.#running.size > 0) {
      await Promise.all([...this.#running.values()].map((execution) => execution.settled));
      if (this.#running.size > 0) {
        await sleep(10);
      }
    }
  }

  #emit(event: TaskHostEvent): void {
    this.#eventEmitter.emit(event);

    const lifecycle = normalizeTaskHostEvent(event);
    if (lifecycle) {
      this.#lifecycleEmitter.emit(lifecycle);
    }
  }
}

function createTaskHost(options: TaskHostOptions): TaskHost {
  return new TaskHostRuntime(options);
}

export {
  createTaskHost,
};
