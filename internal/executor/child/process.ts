import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
  ChildProcessTaskExecutorOptions,
  TaskExecutionHandle,
  TaskExecutor,
  TaskExecutorOutcome,
  TaskExecutorProgressEvent,
  TaskExecutorRunRequest,
} from "#ksjjcxvzvz26";
import { toErrorShape } from "#g6h3y0rvrh9n";

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
    execute: (request) => executeChildProcessTask(options, request),
  };
}

async function executeChildProcessTask(
  options: ChildProcessTaskExecutorOptions,
  request: TaskExecutorRunRequest,
): Promise<TaskExecutionHandle> {
  const child = spawnChildProcess(options, request);
  const state = createChildProcessState();

  attachChildStdout(child, state, request);
  attachChildStderr(child, state);

  return {
    cancel: (reason) => cancelChildProcess(child, state, options, reason),
    completion: createChildCompletion(child, state),
  };
}

function spawnChildProcess(options: ChildProcessTaskExecutorOptions, request: TaskExecutorRunRequest) {
  const runtime = request.handler.entrypoint.runtime ?? "inherit";
  const runtimeCommand = resolveRuntimeCommand(runtime, options);
  const workerPath = fileURLToPath(new URL("./process_worker.js", import.meta.url));

  return spawn(runtimeCommand.command, [...runtimeCommand.prefixArgs, workerPath], {
    cwd: request.handler.entrypoint.cwd || process.cwd(),
    env: createChildWorkerEnv(options, request),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function createChildWorkerEnv(options: ChildProcessTaskExecutorOptions, request: TaskExecutorRunRequest) {
  return {
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
}

function createChildProcessState() {
  return {
    buffer: "",
    cancelled: false,
    settled: false,
    outcome: null as TaskExecutorOutcome | null,
    eventChain: Promise.resolve(),
    stderr: "",
  };
}

function attachChildStdout(
  child: ReturnType<typeof spawn>,
  state: ReturnType<typeof createChildProcessState>,
  request: TaskExecutorRunRequest,
): void {
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    state.buffer += chunk;
    consumeBufferedLines(state, request);
  });
}

function attachChildStderr(child: ReturnType<typeof spawn>, state: ReturnType<typeof createChildProcessState>): void {
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    state.stderr += chunk;
  });
}

function consumeBufferedLines(state: ReturnType<typeof createChildProcessState>, request: TaskExecutorRunRequest): void {
  while (true) {
    const index = state.buffer.indexOf("\n");
    if (index < 0) {
      return;
    }

    const line = state.buffer.slice(0, index);
    state.buffer = state.buffer.slice(index + 1);
    consumeWorkerLine(line, state, request);
  }
}

function consumeWorkerLine(
  line: string,
  state: ReturnType<typeof createChildProcessState>,
  request: TaskExecutorRunRequest,
): void {
  const message = parseWorkerMessage(line);
  if (!message) {
    return;
  }

  if (message.type === "progress" || message.type === "step") {
    state.eventChain = state.eventChain.then(() => request.onEvent?.(message));
    return;
  }

  state.outcome = message.type === "result"
    ? { status: "succeeded", output: message.output }
    : { status: state.cancelled ? "cancelled" : "failed", error: message.error };
}

function parseWorkerMessage(line: string): ChildWorkerMessage | null {
  if (!line.trim()) {
    return null;
  }

  try {
    return JSON.parse(line) as ChildWorkerMessage;
  } catch {
    return null;
  }
}

function createChildCompletion(
  child: ReturnType<typeof spawn>,
  state: ReturnType<typeof createChildProcessState>,
): Promise<TaskExecutorOutcome> {
  return new Promise<TaskExecutorOutcome>((resolve) => {
    child.on("exit", async (code, signal) => {
      if (state.settled) {
        return;
      }

      state.settled = true;
      await state.eventChain;
      resolve(resolveExitOutcome(state, code, signal));
    });

    child.on("error", async (error) => {
      if (state.settled) {
        return;
      }

      state.settled = true;
      await state.eventChain;
      resolve({
        status: state.cancelled ? "cancelled" : "failed",
        error: toErrorShape(error),
      });
    });
  });
}

function resolveExitOutcome(
  state: ReturnType<typeof createChildProcessState>,
  code: number | null,
  signal: NodeJS.Signals | null,
): TaskExecutorOutcome {
  if (state.outcome) {
    return state.outcome;
  }

  if (state.cancelled || signal === "SIGTERM" || signal === "SIGKILL") {
    return {
      status: "cancelled",
    };
  }

  return {
    status: "failed",
    error: toErrorShape(state.stderr || `Child process exited with code ${code ?? "unknown"}`),
  };
}

async function cancelChildProcess(
  child: ReturnType<typeof spawn>,
  state: ReturnType<typeof createChildProcessState>,
  options: ChildProcessTaskExecutorOptions,
  reason?: string,
): Promise<void> {
  if (state.cancelled || child.killed) {
    return;
  }

  state.cancelled = true;
  child.kill("SIGTERM");
  if (reason) {
    state.stderr += `${reason}\n`;
  }

  const killTimeoutMs = options.killTimeoutMs ?? 5_000;
  setTimeout(() => {
    if (child.exitCode == null && child.signalCode == null) {
      child.kill("SIGKILL");
    }
  }, killTimeoutMs).unref?.();
}

export {
  createChildProcessTaskExecutor,
};
