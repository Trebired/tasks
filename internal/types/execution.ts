import type { URL } from "node:url";

import type {
  TaskRecord,
  TaskStepKind,
  TaskStepLevel,
  TaskTerminalError,
} from "./core.js";
import type { TaskCreateResult, TaskEnqueueDisposition } from "./store.js";

export type TaskRetryDecision = {
  retry: boolean;
  scheduledAt?: string | Date | number | null;
};

export type TaskRetryBackoff = {
  minDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: number;
};

export type TaskHandlerModuleContext = {
  task: Pick<TaskRecord, "attempt" | "channels" | "dedupeKey" | "id" | "kind" | "maxAttempts" | "metadata" | "supersedeKey">;
  signal: AbortSignal;
  setProgress: (input: {
    percent?: number | null;
    label?: string | null;
    meta?: Record<string, unknown> | null;
  }) => Promise<void>;
  appendStep: (input: {
    kind?: TaskStepKind;
    level?: TaskStepLevel;
    message?: string;
    label?: string;
    meta?: Record<string, unknown> | null;
    percent?: number | null;
    progressPercent?: number | null;
  }) => Promise<void>;
};

export type TaskHandlerModule<TInput = unknown, TResult = unknown> = {
  run: (input: TInput, context: TaskHandlerModuleContext) => TResult | Promise<TResult>;
};

export type TaskHandlerEntrypoint = {
  module: string | URL;
  export?: string;
  runtime?: "inherit" | "node" | "bun";
  cwd?: string;
  env?: Record<string, string | undefined>;
  args?: string[];
};

export type TaskRetryContext = {
  task: TaskRecord;
  handler: TaskHandlerRegistration;
  error: TaskTerminalError;
  attempt: number;
  maxAttempts: number;
};

export type TaskRetryResolver = (
  context: TaskRetryContext,
) => TaskRetryDecision | string | Date | number | null | Promise<TaskRetryDecision | string | Date | number | null>;

export type TaskRetryPolicy = {
  maxAttempts?: number;
  backoff?: TaskRetryBackoff | TaskRetryResolver;
};

export type TaskHandlerRegistration<TInput = unknown, TResult = unknown> = {
  kind: string;
  entrypoint: TaskHandlerEntrypoint;
  concurrency?: {
    limit?: number;
  };
  retry?: TaskRetryPolicy;
  metadata?: Record<string, unknown> | null;
};

export type TaskEnqueueOptions = {
  id?: string;
  metadata?: Record<string, unknown> | null;
  concurrencyKey?: string | null;
  dedupeKey?: string | null;
  supersedeKey?: string | null;
  supersedeExisting?: boolean;
  channels?: string[] | null;
  maxAttempts?: number;
  scheduledAt?: string | Date | number | null;
};

export type TaskEnqueueResult = TaskCreateResult;

export type TaskExecutorProgressEvent =
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
        kind?: TaskStepKind;
        level?: TaskStepLevel;
        message?: string;
        label?: string;
        meta?: Record<string, unknown> | null;
        percent?: number | null;
        progressPercent?: number | null;
      };
    };

export type TaskExecutorOutcome =
  | {
      status: "succeeded";
      output: unknown;
    }
  | {
      status: "failed";
      error: TaskTerminalError;
    }
  | {
      status: "cancelled";
      error?: TaskTerminalError | null;
    };

export type TaskExecutorRunRequest = {
  task: TaskRecord;
  handler: TaskHandlerRegistration;
  signal: AbortSignal;
  onEvent?: (event: TaskExecutorProgressEvent) => void | Promise<void>;
};

export type TaskExecutionHandle = {
  cancel: (reason?: string) => Promise<void>;
  completion: Promise<TaskExecutorOutcome>;
};

export type TaskExecutor = {
  execute: (request: TaskExecutorRunRequest) => Promise<TaskExecutionHandle> | TaskExecutionHandle;
};

export type TaskHostEvent =
  | {
      type: "runner:start" | "runner:stop";
      timestamp: string;
      runnerId: string;
    }
  | {
      type:
        | "task:enqueued"
        | "task:claimed"
        | "task:running"
        | "task:progress"
        | "task:step"
        | "task:succeeded"
        | "task:retry"
        | "task:failed"
        | "task:cancelled"
        | "task:stale"
        | "task:lease_lost";
      timestamp: string;
      runnerId: string;
      taskId: string;
      kind: string;
      task?: TaskRecord | null;
      deduplicated?: boolean;
      disposition?: TaskEnqueueDisposition;
      supersededTaskIds?: string[];
      step?: import("./core.js").TaskStepRecord | null;
      error?: TaskTerminalError | unknown;
      output?: unknown;
    }
  | {
      type: "task:stale_requeued";
      timestamp: string;
      runnerId: string;
      count: number;
    };

export type TaskHostEventListener = (event: TaskHostEvent) => void;

export type TaskLifecycleEventName =
  | "enqueued"
  | "claimed"
  | "started"
  | "progress"
  | "step"
  | "retried"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "stale"
  | "lease_lost";

export type TaskLifecycleEvent = {
  type: "task.lifecycle";
  event: TaskLifecycleEventName;
  timestamp: string;
  runnerId: string;
  taskId: string;
  kind: string;
  snapshot: import("./core.js").TaskSnapshot | null;
  step: import("./core.js").TaskStepRecord | null;
  channels: string[];
  disposition?: TaskEnqueueDisposition;
  supersededTaskIds?: string[];
  error?: TaskTerminalError | unknown;
  output?: unknown;
};

export type TaskLifecycleEventListener = (event: TaskLifecycleEvent) => void;
