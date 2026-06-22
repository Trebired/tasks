import { describe, expect, test } from "bun:test";

import {
  createTaskHostEventAdapter,
  createTaskLifecycleEventAdapter,
  createTaskSnapshot,
  normalizeTaskHostEventEntry,
  normalizeTaskLifecycleEventEntry,
  type TaskHostEvent,
  type TaskLifecycleEvent,
  type TaskRecord,
  type TaskStepRecord,
} from "#8t8bq600b4wu";

function createTaskRecord(): TaskRecord {
  const now = new Date().toISOString();

  return {
    id: "task_events",
    kind: "example.run",
    status: "running",
    input: {
      value: "alpha",
    },
    output: null,
    error: null,
    metadata: null,
    progressPercent: 35,
    progressLabel: "working",
    progressMeta: {
      chunk: 2,
    },
    concurrencyKey: "example:alpha",
    dedupeKey: "dedupe:alpha",
    supersedeKey: "supersede:alpha",
    channels: ["scope:tests", "topic:events"],
    attempt: 1,
    maxAttempts: 3,
    scheduledAt: now,
    createdAt: now,
    updatedAt: now,
    claimedAt: now,
    startedAt: now,
    finishedAt: null,
    cancelRequestedAt: null,
    leaseOwner: "runner_test",
    leaseToken: "lease_token",
    leaseExpiresAt: now,
    lastHeartbeatAt: now,
    retryScheduledAt: null,
    staleAt: null,
    staleReason: null,
  };
}

function createStep(): TaskStepRecord {
  return {
    id: "step_1",
    taskId: "task_events",
    attempt: 1,
    kind: "checkpoint",
    level: "warn",
    message: "Halfway there",
    meta: {
      chunk: 2,
    },
    percent: 50,
    createdAt: new Date().toISOString(),
  };
}

describe("task event helpers", () => {
  test("normalizes lifecycle events into presentation-friendly entries", () => {
    const task = createTaskRecord();
    const step = createStep();
    const event: TaskLifecycleEvent = {
      type: "task.lifecycle",
      event: "step",
      timestamp: step.createdAt,
      runnerId: "runner_test",
      taskId: task.id,
      kind: task.kind,
      snapshot: createTaskSnapshot(task),
      step,
      channels: ["scope:tests", "topic:events"],
    };

    expect(normalizeTaskLifecycleEventEntry(event)).toEqual({
      type: "step",
      level: "warn",
      message: "Halfway there",
      percent: 50,
      timestamp: step.createdAt,
      metadata: {
        channels: ["scope:tests", "topic:events"],
        progressLabel: "working",
        progressMeta: {
          chunk: 2,
        },
        stepKind: "checkpoint",
        stepMeta: {
          chunk: 2,
        },
      },
      runnerId: "runner_test",
      taskId: "task_events",
      kind: "example.run",
      state: "running",
      channels: ["scope:tests", "topic:events"],
      stepId: "step_1",
    });
  });

  test("normalizes host runner events without consumer parsing", () => {
    const event: TaskHostEvent = {
      type: "runner:start",
      timestamp: new Date().toISOString(),
      runnerId: "runner_test",
    };

    expect(normalizeTaskHostEventEntry(event)).toMatchObject({
      type: "runner_started",
      level: "info",
      message: "Task runner started",
      runnerId: "runner_test",
    });
  });

  test("creates lifecycle adapters that forward normalized entries", async () => {
    const task = createTaskRecord();
    const event: TaskLifecycleEvent = {
      type: "task.lifecycle",
      event: "succeeded",
      timestamp: new Date().toISOString(),
      runnerId: "runner_test",
      taskId: task.id,
      kind: task.kind,
      snapshot: createTaskSnapshot({
        ...task,
        status: "succeeded",
        output: {
          ok: true,
        },
        progressPercent: 100,
        finishedAt: new Date().toISOString(),
      }),
      step: null,
      channels: ["scope:tests"],
      output: {
        ok: true,
      },
    };
    const seen: Array<{
      entryType: string;
      sourceType: string;
    }> = [];
    const listener = createTaskLifecycleEventAdapter(async (entry, source) => {
      seen.push({
        entryType: entry.type,
        sourceType: source.event,
      });
    });

    await listener(event);

    expect(seen).toEqual([
      {
        entryType: "succeeded",
        sourceType: "succeeded",
      },
    ]);
  });

  test("creates host adapters that forward normalized entries", async () => {
    const task = createTaskRecord();
    const event: TaskHostEvent = {
      type: "task:failed",
      timestamp: new Date().toISOString(),
      runnerId: "runner_test",
      taskId: task.id,
      kind: task.kind,
      task: {
        ...task,
        status: "failed",
        error: {
          message: "boom",
        },
        finishedAt: new Date().toISOString(),
      },
      error: {
        message: "boom",
      },
    };
    const seen: Array<{
      entryType: string;
      sourceType: string;
    }> = [];
    const listener = createTaskHostEventAdapter(async (entry, source) => {
      seen.push({
        entryType: entry.type,
        sourceType: source.type,
      });
    });

    await listener(event);

    expect(seen).toEqual([
      {
        entryType: "failed",
        sourceType: "task:failed",
      },
    ]);
  });
});
