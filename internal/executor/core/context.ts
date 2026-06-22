import type {
  TaskExecutorProgressEvent,
  TaskHandlerModuleContext,
  TaskRecord,
} from "#2kjvrax0gr4m";
import { clampPercent } from "./utils.js";

type TaskContextTask = Pick<
  TaskRecord,
  "attempt" | "channels" | "dedupeKey" | "id" | "kind" | "maxAttempts" | "metadata" | "supersedeKey"
>;

function createTaskHandlerContext(
  task: TaskContextTask,
  signal: AbortSignal,
  onEvent?: (event: TaskExecutorProgressEvent) => void | Promise<void>,
): TaskHandlerModuleContext {
  return {
    task,
    signal,
    async setProgress(input) {
      await onEvent?.({
        type: "progress",
        progress: {
          percent: clampPercent(input.percent),
          label: input.label ?? null,
          meta: input.meta ?? null,
        },
      });
    },
    async appendStep(input) {
      await onEvent?.({
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
  };
}

export {
  createTaskHandlerContext,
};
