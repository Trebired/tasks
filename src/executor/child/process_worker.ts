import process from "node:process";

import type { TaskHandlerModule, TaskTerminalError } from "#ksjjcxvzvz26";
import { toErrorShape } from "#g6h3y0rvrh9n";
import { createTaskHandlerContext } from "#pomfbdrkgf10";
import { loadTaskHandlerModule } from "#sqsl30t1mk0x";

type ChildWorkerPayload = {
  task: {
    id: string;
    kind: string;
    attempt: number;
    maxAttempts: number;
    metadata: Record<string, unknown> | null;
    channels?: string[];
    dedupeKey?: string | null;
    supersedeKey?: string | null;
    input: unknown;
  };
  handler: {
    module: string;
    export?: string;
  };
};

type ChildWorkerMessage =
  | {
    type: "progress";
    progress: {
      percent?: number | null;
      label?: string | null;
      meta?: Record<string, unknown> | null;
    };
  }
  | {
    type: "step";
    step: {
      kind?: "step" | "event" | "checkpoint" | "log" | string;
      level?: string;
      message: string;
      meta?: Record<string, unknown> | null;
      percent?: number | null;
    };
  }
  | {
    type: "result";
    output: unknown;
  }
  | {
    type: "error";
    error: TaskTerminalError;
  };

function emit(message: ChildWorkerMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function main(): Promise<void> {
  const payload = readWorkerPayload();
  const handler = await loadWorkerHandler(payload);
  const controller = new AbortController();
  bindProcessSignals(controller);

  try {
    emit({
      type: "result",
      output: await handler.run(payload.task.input, createHandlerContext(payload, controller.signal)),
    });
  } catch (error) {
    emit({
      type: "error",
      error: toErrorShape(error),
    });
    process.exitCode = 1;
  }
}

function readWorkerPayload(): ChildWorkerPayload {
  const encoded = process.env.TB_TASK_CHILD_PAYLOAD;
  if (!encoded) {
    throw new Error("Missing TB_TASK_CHILD_PAYLOAD");
  }

  return JSON.parse(encoded) as ChildWorkerPayload;
}

async function loadWorkerHandler(payload: ChildWorkerPayload): Promise<TaskHandlerModule> {
  return await loadTaskHandlerModule(payload.handler);
}

function bindProcessSignals(controller: AbortController): void {
  const exit = () => controller.abort();
  process.on("SIGINT", exit);
  process.on("SIGTERM", exit);
}

function createHandlerContext(payload: ChildWorkerPayload, signal: AbortSignal) {
  return createTaskHandlerContext({
    id: payload.task.id,
    kind: payload.task.kind,
    attempt: payload.task.attempt,
    maxAttempts: payload.task.maxAttempts,
    metadata: payload.task.metadata,
    channels: payload.task.channels || [],
    dedupeKey: payload.task.dedupeKey ?? null,
    supersedeKey: payload.task.supersedeKey ?? null,
  }, signal, async (event) => {
    if (event.type === "progress") {
      emit({
        type: "progress",
        progress: event.progress,
      });
      return;
    }

    emit({
      type: "step",
      step: {
        kind: event.step.kind ?? "step",
        level: event.step.level ?? "info",
        message: event.step.message || event.step.label || "step",
        meta: event.step.meta ?? null,
        percent: event.step.percent ?? event.step.progressPercent ?? null,
      },
    });
  });
}

void main();
