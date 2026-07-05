import type {
  InProcessTaskExecutorOptions,
  TaskExecutionHandle,
  TaskExecutor,
  TaskExecutorOutcome,
  TaskExecutorRunRequest,
} from "#2kjvrax0gr4m";
import { toErrorShape } from "#g6h3y0rvrh9n";
import { createTaskHandlerContext } from "./core/context.js";
import {
  defaultTaskModuleLoader,
  loadTaskHandlerModule,
} from "./core/module.js";

function createInProcessTaskExecutor(options: InProcessTaskExecutorOptions = {}): TaskExecutor {
  return {
    execute: (request) => executeInProcessTask(options, request),
  };
}

async function executeInProcessTask(
  options: InProcessTaskExecutorOptions,
  request: TaskExecutorRunRequest,
): Promise<TaskExecutionHandle> {
  const controller = new AbortController();
  const cleanup = bindRequestSignal(controller, request.signal);
  const completion = runInProcessTask(options, request, controller.signal, cleanup);

  return {
    cancel: async (reason) => {
      controller.abort(reason ? new Error(reason) : new Error("Task cancelled"));
    },
    completion,
  };
}

function bindRequestSignal(controller: AbortController, signal: AbortSignal): () => void {
  if (signal.aborted) {
    controller.abort(signal.reason);
    return () => undefined;
  }

  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, {
    once: true,
  });

  return () => signal.removeEventListener("abort", abort);
}

async function runInProcessTask(
  options: InProcessTaskExecutorOptions,
  request: TaskExecutorRunRequest,
  signal: AbortSignal,
  cleanup: () => void,
): Promise<TaskExecutorOutcome> {
  try {
    if (signal.aborted) {
      return {
        status: "cancelled",
      };
    }

    const handler = await loadTaskHandlerModule(request.handler.entrypoint, options.loadModule || defaultTaskModuleLoader);
    if (signal.aborted) {
      return {
        status: "cancelled",
      };
    }

    const output = await handler.run(
      request.task.input,
      createTaskHandlerContext(request.task, signal, request.onEvent),
    );

    return signal.aborted
      ? {
        status: "cancelled",
      }
      : {
        status: "succeeded",
        output,
      };
  } catch (error) {
    if (signal.aborted || isAbortLikeError(error)) {
      return {
        status: "cancelled",
        error: toErrorShape(error, "Task cancelled"),
      };
    }

    return {
      status: "failed",
      error: toErrorShape(error),
    };
  } finally {
    cleanup();
  }
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const value = error as {
    code?: unknown;
    name?: unknown;
  };

  return value.name === "AbortError" || value.code === "ABORT_ERR";
}

export {
  createInProcessTaskExecutor,
};
