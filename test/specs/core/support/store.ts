import { buildTaskAggregateSnapshot, createTaskSnapshot } from "#ir9grtwyf3f1";
import type {
  TaskAggregateSnapshot,
  TaskAppendStepInput,
  TaskCancelInput,
  TaskCancelRunningInput,
  TaskClaimNextOptions,
  TaskCreateInput,
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

import {
  clearTaskStaleState,
  createCreatedTaskResult,
  createReusedTaskResult,
  createTaskRecord,
  createTaskStepRecord,
  filterTasksByChannels,
  filterTasksByIdentifiers,
  filterTasksByKeys,
  isActiveTaskStatus,
  releaseTaskLease,
  shouldMarkTaskStale,
} from "./helpers";

export class MemoryTaskStore implements TaskStore {
  tasks = new Map<string, TaskRecord>();
  steps = new Map<string, TaskStepRecord[]>();
  sequence = 0;

  async createTask<TInput = unknown>(input: TaskCreateInput<TInput>) {
    const reusableTask = this.findReusableTask(input);
    if (reusableTask) {
      return createReusedTaskResult(reusableTask);
    }

    const supersededTaskIds = this.cancelSupersededTasks(input);
    const task = createTaskRecord(input, new Date().toISOString());
    this.tasks.set(task.id, task);
    return createCreatedTaskResult(task, supersededTaskIds);
  }

  async getTask<TInput = unknown, TResult = unknown>(taskId: string): Promise<TaskRecord<TInput, TResult> | null> {
    return (this.tasks.get(taskId) || null) as TaskRecord<TInput, TResult> | null;
  }

  async listTasks<TInput = unknown, TResult = unknown>(query: TaskListQuery = {}): Promise<TaskRecord<TInput, TResult>[]> {
    let tasks = [...this.tasks.values()];
    tasks = filterTasksByIdentifiers(tasks, query);
    tasks = filterTasksByChannels(tasks, query);
    tasks = filterTasksByKeys(tasks, query);
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

    const claimedAt = new Date().toISOString();
    task.status = "claimed";
    task.attempt += 1;
    task.leaseOwner = input.runnerId;
    task.leaseToken = `${task.id}:${task.attempt}`;
    task.claimedAt = claimedAt;
    task.updatedAt = claimedAt;
    task.leaseExpiresAt = new Date(Date.now() + input.leaseMs).toISOString();
    task.lastHeartbeatAt = claimedAt;
    clearTaskStaleState(task);
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
    clearTaskStaleState(task);
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
    clearTaskStaleState(task);
    return task as TaskRecord<TInput, TResult>;
  }

  async appendTaskStep(input: TaskAppendStepInput): Promise<TaskStepRecord | null> {
    const task = this.tasks.get(input.taskId);
    if (!task || task.leaseToken !== input.leaseToken) {
      return null;
    }
    const step = createTaskStepRecord(input, String(++this.sequence));
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
    clearTaskStaleState(task);
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
    releaseTaskLease(task);
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
    releaseTaskLease(task);
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
    releaseTaskLease(task);
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
    releaseTaskLease(task);
    return task as TaskRecord<TInput, TResult>;
  }

  async markStaleTasks<TInput = unknown, TResult = unknown>(input: TaskMarkStaleInput): Promise<TaskRecord<TInput, TResult>[]> {
    const current = input.now || new Date().toISOString();
    const threshold = Date.parse(current) - input.staleAfterMs;
    const stale: TaskRecord[] = [];

    for (const task of this.tasks.values()) {
      const reference = Date.parse(task.lastHeartbeatAt || task.updatedAt);
      if (shouldMarkTaskStale(task, reference, threshold)) {
        task.staleAt = current;
        task.staleReason = input.reason || "Task became stale";
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

  private findReusableTask<TInput>(input: TaskCreateInput<TInput>): TaskRecord | null {
    if (!input.dedupeKey) {
      return null;
    }
    for (const task of this.tasks.values()) {
      if (task.kind === input.kind && task.dedupeKey === input.dedupeKey && isActiveTaskStatus(task.status)) {
        return task;
      }
    }
    return null;
  }

  private cancelSupersededTasks<TInput>(input: TaskCreateInput<TInput>): string[] {
    if (!input.supersedeExisting || !input.supersedeKey) {
      return [];
    }

    const supersededTaskIds: string[] = [];
    for (const task of this.tasks.values()) {
      if (task.kind === input.kind && task.supersedeKey === input.supersedeKey && isActiveTaskStatus(task.status)) {
        task.status = "cancelled";
        task.finishedAt = new Date().toISOString();
        supersededTaskIds.push(task.id);
      }
    }
    return supersededTaskIds;
  }
}
