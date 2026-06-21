import process from "node:process";

import type { TaskHandlerModule, TaskTerminalError } from "../types.js";
import { clampPercent, toErrorShape } from "../core/utils.js";

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

function resolveHandlerExport(mod: Record<string, unknown>, exportName?: string): TaskHandlerModule {
  const candidate = exportName ? mod[exportName] : mod.default ?? mod.handler ?? mod;

  if (typeof candidate === "function") {
    return {
      run: candidate as TaskHandlerModule["run"],
    };
  }

  if (candidate && typeof candidate === "object" && typeof (candidate as TaskHandlerModule).run === "function") {
    return candidate as TaskHandlerModule;
  }

  throw new Error(`Handler export "${exportName || "default"}" does not expose a run() function`);
}

async function main(): Promise<void> {
  const encoded = process.env.TB_TASK_CHILD_PAYLOAD;
  if (!encoded) {
    throw new Error("Missing TB_TASK_CHILD_PAYLOAD");
  }

  const payload = JSON.parse(encoded) as ChildWorkerPayload;
  const mod = await import(payload.handler.module);
  const handler = resolveHandlerExport(mod as Record<string, unknown>, payload.handler.export);

  const controller = new AbortController();
  const exit = () => controller.abort();

  process.on("SIGINT", exit);
  process.on("SIGTERM", exit);

  try {
    const output = await handler.run(payload.task.input, {
      task: {
        id: payload.task.id,
        kind: payload.task.kind,
        attempt: payload.task.attempt,
        maxAttempts: payload.task.maxAttempts,
        metadata: payload.task.metadata,
        channels: payload.task.channels || [],
        dedupeKey: payload.task.dedupeKey ?? null,
        supersedeKey: payload.task.supersedeKey ?? null,
      },
      signal: controller.signal,
      async setProgress(input) {
        emit({
          type: "progress",
          progress: {
            percent: clampPercent(input.percent),
            label: input.label ?? null,
            meta: input.meta ?? null,
          },
        });
      },
      async appendStep(input) {
        emit({
          type: "step",
          step: {
            kind: input.kind ?? "step",
            level: input.level ?? "info",
            message: input.message || input.label || "step",
            meta: input.meta ?? null,
            percent: clampPercent(input.percent ?? input.progressPercent),
          },
        });
      },
    });

    emit({
      type: "result",
      output,
    });
  } catch (error) {
    emit({
      type: "error",
      error: toErrorShape(error),
    });
    process.exitCode = 1;
  }
}

void main();
