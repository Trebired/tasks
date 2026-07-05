import { createTaskHost } from "#8t8bq600b4wu";
import type { TaskExecutionHandle, TaskExecutor, TaskExecutorRunRequest } from "#2kjvrax0gr4m";

import { MemoryTaskStore } from "./store";

const REPORT_TASK_MODULE_URL = new URL("../../../../examples/handlers/report_task.ts", import.meta.url);

export class FakeSocket {
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

export class FakeSocketServer {
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

export function createDemoTaskHost(
  store: MemoryTaskStore,
  kind: string,
  stepMessage: string,
  output: Record<string, unknown>,
) {
  return createTaskHost({
    store,
    executor: createDemoExecutor(stepMessage, output, 25),
    handlers: [
      {
        kind,
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
  });
}

export function createDemoExecutor(stepMessage: string, output: Record<string, unknown>, delayMs = 0): TaskExecutor {
  return {
    async execute(request): Promise<TaskExecutionHandle> {
      await request.onEvent?.({
        type: "step",
        step: {
          message: stepMessage,
          level: "info",
          percent: 50,
        },
      });

      return {
        async cancel() {
          return;
        },
        completion: createExecutionCompletion(output, delayMs),
      };
    },
  };
}

export function createLifecycleExecutor(): TaskExecutor {
  return {
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
}

export function createReportTaskModuleUrl(): URL {
  return REPORT_TASK_MODULE_URL;
}

export async function waitForTaskToReachState(
  readState: () => Promise<string | null | undefined>,
  expectedState: string,
): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    if ((await readState()) === expectedState) {
      return;
    }
    await waitForNextPoll();
  }
}

export async function waitForSocketSuccessEvent(socket: FakeSocket): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    if (findSucceededSocketEvent(socket)) {
      return;
    }
    await waitForNextPoll();
  }
}

export function findSucceededSocketEvent(socket: FakeSocket) {
  return socket.emitted.find((entry) => {
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
}

export async function emitLiveDemoEvents(request: Pick<TaskExecutorRunRequest, "onEvent">): Promise<void> {
  await request.onEvent?.({
    type: "progress",
    progress: {
      percent: 30,
      label: "loading",
    },
  });
  await request.onEvent?.({
    type: "step",
    step: {
      message: "Source loaded",
      percent: 30,
    },
  });
  await request.onEvent?.({
    type: "progress",
    progress: {
      percent: 100,
      label: "done",
    },
  });
}

function createExecutionCompletion(output: Record<string, unknown>, delayMs: number) {
  if (delayMs <= 0) {
    return Promise.resolve({
      status: "succeeded" as const,
      output,
    });
  }

  return new Promise<{ status: "succeeded"; output: Record<string, unknown> }>((resolve) => {
    setTimeout(() => {
      resolve({
        status: "succeeded",
        output,
      });
    }, delayMs);
  });
}

async function waitForNextPoll(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
