import {
  DEFAULT_TASK_BACKOFF_FACTOR,
  DEFAULT_TASK_BACKOFF_JITTER,
  DEFAULT_TASK_BACKOFF_MAX_DELAY_MS,
  DEFAULT_TASK_BACKOFF_MIN_DELAY_MS,
} from "#5dtdwzlie8fm";
import type {
  TaskHandlerRegistration,
  TaskRecord,
  TaskRetryBackoff,
  TaskRetryContext,
  TaskRetryDecision,
  TaskRetryResolver,
  TaskTerminalError,
} from "#2kjvrax0gr4m";
import { nowIso } from "./utils.js";

function resolveBackoffMs(attempt: number, backoff?: TaskRetryBackoff | null): number {
  const minDelayMs = backoff?.minDelayMs ?? DEFAULT_TASK_BACKOFF_MIN_DELAY_MS;
  const maxDelayMs = backoff?.maxDelayMs ?? DEFAULT_TASK_BACKOFF_MAX_DELAY_MS;
  const factor = backoff?.factor ?? DEFAULT_TASK_BACKOFF_FACTOR;
  const jitter = backoff?.jitter ?? DEFAULT_TASK_BACKOFF_JITTER;

  const base = Math.min(minDelayMs * Math.max(1, factor) ** Math.max(0, attempt - 1), maxDelayMs);
  const jitterDelta = base * jitter;
  const random = jitterDelta > 0 ? (Math.random() * jitterDelta * 2) - jitterDelta : 0;
  return Math.max(minDelayMs, Math.min(maxDelayMs, Math.round(base + random)));
}

async function resolveRetryDecision(input: {
  task: TaskRecord;
  handler: TaskHandlerRegistration;
  error: TaskTerminalError;
  defaultMaxAttempts: number;
}): Promise<TaskRetryDecision> {
  const policy = input.handler.retry;
  const maxAttempts = Math.max(1, policy?.maxAttempts ?? input.task.maxAttempts ?? input.defaultMaxAttempts);
  const attempt = input.task.attempt;
  const context: TaskRetryContext = {
    task: input.task,
    handler: input.handler,
    error: input.error,
    attempt,
    maxAttempts,
  };
  const backoff = policy?.backoff;

  if (attempt >= maxAttempts) {
    return { retry: false };
  }

  if (typeof backoff === "function") {
    return resolveFunctionRetryDecision(attempt, backoff as TaskRetryResolver, context);
  }

  return createRetryDecision(attempt, backoff);
}

async function resolveFunctionRetryDecision(
  attempt: number,
  resolver: TaskRetryResolver,
  context: TaskRetryContext,
): Promise<TaskRetryDecision> {
  const resolved = await resolver(context);
  if (resolved == null) {
    return { retry: false };
  }

  if (typeof resolved === "object" && !Array.isArray(resolved) && "retry" in resolved) {
    const decision = resolved as TaskRetryDecision;
    if (!decision.retry) {
      return { retry: false };
    }

    return {
      retry: true,
      scheduledAt: decision.scheduledAt ?? nowIso(Date.now() + resolveBackoffMs(attempt, null)),
    };
  }

  return {
    retry: true,
    scheduledAt: nowIso(resolved as string | Date | number),
  };
}

function createRetryDecision(attempt: number, backoff?: TaskRetryBackoff | null): TaskRetryDecision {
  return {
    retry: true,
    scheduledAt: nowIso(Date.now() + resolveBackoffMs(attempt, backoff)),
  };
}

export {
  resolveRetryDecision,
};
