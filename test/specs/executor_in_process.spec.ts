import { describe, expect, test } from "bun:test";

import {
  createInProcessTaskExecutor,
  type TaskExecutorProgressEvent,
  type TaskRecord,
} from "#8t8bq600b4wu";

function createTaskRecord(): TaskRecord<{
  value: string;
}> {
  const now = new Date().toISOString();

  return {
    id: "task_in_process",
    kind: "example.run",
    status: "running",
    input: {
      value: "alpha",
    },
    output: null,
    error: null,
    metadata: null,
    progressPercent: null,
    progressLabel: null,
    progressMeta: null,
    concurrencyKey: null,
    dedupeKey: "dedupe:alpha",
    supersedeKey: "supersede:alpha",
    channels: ["scope:tests"],
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

function createFixtureUrl(name: string): URL {
  return new URL(`../fixtures/${name}`, import.meta.url);
}

describe("createInProcessTaskExecutor", () => {
  test("loads a handler module and forwards progress and steps", async () => {
    const executor = createInProcessTaskExecutor();
    const events: TaskExecutorProgressEvent[] = [];
    const handle = await executor.execute({
      task: createTaskRecord(),
      handler: {
        kind: "example.run",
        entrypoint: {
          module: createFixtureUrl("in_process_success.ts"),
        },
      },
      signal: new AbortController().signal,
      onEvent(event) {
        events.push(event);
      },
    });

    await expect(handle.completion).resolves.toEqual({
      status: "succeeded",
      output: {
        echoed: "alpha",
      },
    });
    expect(events).toEqual([
      {
        type: "progress",
        progress: {
          percent: 25,
          label: "loading",
          meta: {
            value: "alpha",
          },
        },
      },
      {
        type: "step",
        step: {
          kind: "step",
          level: "info",
          message: "Halfway there",
          meta: {
            signalAborted: false,
          },
          percent: 50,
        },
      },
    ]);
  });

  test("returns failed outcomes with normalized errors", async () => {
    const executor = createInProcessTaskExecutor();
    const handle = await executor.execute({
      task: createTaskRecord(),
      handler: {
        kind: "example.run",
        entrypoint: {
          module: createFixtureUrl("in_process_failure.ts"),
          export: "handler",
        },
      },
      signal: new AbortController().signal,
    });

    await expect(handle.completion).resolves.toMatchObject({
      status: "failed",
      error: {
        message: "boom",
        code: "EFAIL",
        details: {
          source: "fixture",
        },
      },
    });
  });

  test("supports cooperative cancellation through AbortSignal", async () => {
    const executor = createInProcessTaskExecutor();
    const handle = await executor.execute({
      task: createTaskRecord(),
      handler: {
        kind: "example.run",
        entrypoint: {
          module: createFixtureUrl("in_process_abort.ts"),
        },
      },
      signal: new AbortController().signal,
    });

    await handle.cancel("Stop requested");

    await expect(handle.completion).resolves.toMatchObject({
      status: "cancelled",
    });
  });
});
