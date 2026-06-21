import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
  ChildProcessTaskExecutorOptions,
  TaskExecutionHandle,
  TaskExecutor,
  TaskExecutorOutcome,
  TaskExecutorProgressEvent,
  TaskExecutorRunRequest,
} from "../types.js";
import { toErrorShape } from "../core/utils.js";

type ChildWorkerMessage =
  | {
    type: "progress";
    progress: TaskExecutorProgressEvent extends infer T ? T extends {
      type: "progress";
      progress: infer P;
    } ? P : never : never;
  }
  | {
    type: "step";
    step: TaskExecutorProgressEvent extends infer T ? T extends {
      type: "step";
      step: infer P;
    } ? P : never : never;
  }
  | {
    type: "result";
    output: unknown;
  }
  | {
    type: "error";
    error: ReturnType<typeof toErrorShape>;
  };

function resolveRuntimeCommand(runtime: "inherit" | "node" | "bun", options: ChildProcessTaskExecutorOptions): {
  command: string;
  prefixArgs: string[];
} {
  if (options.command) {
    return {
      command: options.command,
      prefixArgs: options.args ?? [],
    };
  }

  if (runtime === "bun" || (runtime === "inherit" && process.versions.bun)) {
    return {
      command: "bun",
      prefixArgs: ["run", ...(options.args ?? [])],
    };
  }

  return {
    command: runtime === "node" ? "node" : process.execPath,
    prefixArgs: options.args ?? [],
  };
}

function resolveModuleSpecifier(input: string | URL): string {
  if (input instanceof URL) {
    return input.href;
  }

  if (input.startsWith("file://") || input.startsWith("data:") || input.startsWith("node:")) {
    return input;
  }

  if (input.startsWith("/") || input.startsWith(".")) {
    return pathToFileURL(input).href;
  }

  return input;
}

function createChildProcessTaskExecutor(options: ChildProcessTaskExecutorOptions = {}): TaskExecutor {
  return {
    async execute(request: TaskExecutorRunRequest): Promise<TaskExecutionHandle> {
      const runtime = request.handler.entrypoint.runtime ?? "inherit";
      const workerPath = fileURLToPath(new URL("./child_process_worker.js", import.meta.url));
      const runtimeCommand = resolveRuntimeCommand(runtime, options);
      const args = [...runtimeCommand.prefixArgs, workerPath];
      const env = {
        ...process.env,
        ...options.env,
        ...request.handler.entrypoint.env,
        TB_TASK_CHILD_PAYLOAD: JSON.stringify({
          task: {
            id: request.task.id,
            kind: request.task.kind,
            attempt: request.task.attempt,
            maxAttempts: request.task.maxAttempts,
            metadata: request.task.metadata ?? null,
            channels: request.task.channels || [],
            dedupeKey: request.task.dedupeKey ?? null,
            supersedeKey: request.task.supersedeKey ?? null,
            input: request.task.input,
          },
          handler: {
            module: resolveModuleSpecifier(request.handler.entrypoint.module),
            export: request.handler.entrypoint.export,
          },
        }),
      };

      const child = spawn(runtimeCommand.command, args, {
        cwd: request.handler.entrypoint.cwd || process.cwd(),
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let buffer = "";
      let cancelled = false;
      let settled = false;
      let outcome: TaskExecutorOutcome | null = null;
      let eventChain = Promise.resolve();
      let stderr = "";

      const consumeLine = (line: string) => {
        if (!line.trim()) {
          return;
        }

        let message: ChildWorkerMessage;
        try {
          message = JSON.parse(line) as ChildWorkerMessage;
        } catch {
          return;
        }

        if (message.type === "progress") {
          eventChain = eventChain.then(() => request.onEvent?.({
            type: "progress",
            progress: message.progress,
          }));
          return;
        }

        if (message.type === "step") {
          eventChain = eventChain.then(() => request.onEvent?.({
            type: "step",
            step: message.step,
          }));
          return;
        }

        if (message.type === "result") {
          outcome = {
            status: "succeeded",
            output: message.output,
          };
          return;
        }

        if (message.type === "error") {
          outcome = {
            status: cancelled ? "cancelled" : "failed",
            error: message.error,
          };
        }
      };

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        buffer += chunk;

        while (true) {
          const index = buffer.indexOf("\n");
          if (index < 0) {
            break;
          }

          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          consumeLine(line);
        }
      });

      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });

      const completion = new Promise<TaskExecutorOutcome>((resolve) => {
        child.on("exit", async (code, signal) => {
          if (settled) {
            return;
          }

          settled = true;
          await eventChain;

          if (outcome) {
            resolve(outcome);
            return;
          }

          if (cancelled || signal === "SIGTERM" || signal === "SIGKILL") {
            resolve({
              status: "cancelled",
            });
            return;
          }

          resolve({
            status: "failed",
            error: toErrorShape(stderr || `Child process exited with code ${code ?? "unknown"}`),
          });
        });

        child.on("error", async (error) => {
          if (settled) {
            return;
          }

          settled = true;
          await eventChain;
          resolve({
            status: cancelled ? "cancelled" : "failed",
            error: toErrorShape(error),
          });
        });
      });

      return {
        async cancel(reason?: string) {
          if (cancelled || child.killed) {
            return;
          }

          cancelled = true;
          child.kill("SIGTERM");

          const killTimeoutMs = options.killTimeoutMs ?? 5_000;
          setTimeout(() => {
            if (child.exitCode == null && child.signalCode == null) {
              child.kill("SIGKILL");
            }
          }, killTimeoutMs).unref?.();

          if (reason) {
            stderr += `${reason}\n`;
          }
        },
        completion,
      };
    },
  };
}

export {
  createChildProcessTaskExecutor,
};
