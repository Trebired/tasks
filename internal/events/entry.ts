import type {
  TaskEventEntry,
  TaskHostEvent,
  TaskLifecycleEvent,
  TaskLifecycleEventName,
  TaskLifecycleState,
  TaskStepLevel,
} from "#2kjvrax0gr4m";
import { toRecord } from "#92c6666f713d";
import { normalizeTaskHostEvent } from "#b3d930a4472b";

function normalizeTaskLifecycleEventEntry(event: TaskLifecycleEvent): TaskEventEntry {
  return {
    type: event.event,
    level: resolveLifecycleLevel(event),
    message: resolveLifecycleMessage(event),
    percent: event.step?.percent ?? event.snapshot?.progress.percent ?? null,
    timestamp: event.timestamp,
    metadata: createLifecycleMetadata(event),
    runnerId: event.runnerId,
    taskId: event.taskId,
    kind: event.kind,
    state: event.snapshot?.state ?? null,
    channels: event.channels,
    stepId: event.step?.id ?? null,
  };
}

function normalizeTaskHostEventEntry(event: TaskHostEvent): TaskEventEntry {
  const lifecycle = normalizeTaskHostEvent(event);

  if (lifecycle) {
    return normalizeTaskLifecycleEventEntry(lifecycle);
  }

  if (event.type === "runner:start" || event.type === "runner:stop" || event.type === "task:stale_requeued") {
    return createNonTaskEventEntry(event);
  }

  throw new Error(`Unsupported task host event: ${event.type}`);
}

function resolveLifecycleLevel(event: TaskLifecycleEvent): TaskStepLevel {
  if (event.event === "step") {
    return event.step?.level ?? "info";
  }

  switch (event.event) {
    case "succeeded":
      return "success";
    case "failed":
    case "lease_lost":
      return "error";
    case "retried":
    case "cancelled":
    case "stale":
      return "warn";
    default:
      return "info";
  }
}

function resolveLifecycleMessage(event: TaskLifecycleEvent): string {
  if (event.event === "step") {
    return event.step?.message || "Task step recorded";
  }

  return lifecycleMessages[event.event];
}

function createLifecycleMetadata(event: TaskLifecycleEvent): Record<string, unknown> | null {
  const metadata = {
    channels: event.channels,
    disposition: event.disposition,
    error: event.error,
    output: event.output,
    progressLabel: event.snapshot?.progress.label ?? null,
    progressMeta: event.snapshot?.progress.meta ?? null,
    stepKind: event.step?.kind ?? null,
    stepMeta: event.step?.meta ?? null,
    supersededTaskIds: event.supersededTaskIds ?? null,
  };

  return toRecord(removeEmptyFields(metadata));
}

function createNonTaskEventEntry(
  event: Extract<TaskHostEvent, {
    type: "runner:start" | "runner:stop" | "task:stale_requeued";
  }>,
): TaskEventEntry {
  if (event.type === "task:stale_requeued") {
    return {
      type: "stale_requeued",
      level: "warn",
      message: "Stale tasks requeued",
      percent: null,
      timestamp: event.timestamp,
      metadata: {
        count: event.count,
      },
      runnerId: event.runnerId,
      taskId: null,
      kind: null,
      state: null,
      channels: [],
      stepId: null,
    };
  }

  return {
    type: event.type === "runner:start" ? "runner_started" : "runner_stopped",
    level: "info",
    message: event.type === "runner:start" ? "Task runner started" : "Task runner stopped",
    percent: null,
    timestamp: event.timestamp,
    metadata: null,
    runnerId: event.runnerId,
    taskId: null,
    kind: null,
    state: null,
    channels: [],
    stepId: null,
  };
}

function removeEmptyFields(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value == null) {
      continue;
    }

    if (Array.isArray(value) && value.length === 0) {
      continue;
    }

    output[key] = value;
  }

  return output;
}

const lifecycleMessages: Record<TaskLifecycleEventName, string> = {
  enqueued: "Task enqueued",
  claimed: "Task claimed",
  started: "Task started",
  progress: "Task progress updated",
  step: "Task step recorded",
  retried: "Task scheduled for retry",
  succeeded: "Task succeeded",
  failed: "Task failed",
  cancelled: "Task cancelled",
  stale: "Task marked stale",
  lease_lost: "Task lease lost",
};

export {
  normalizeTaskHostEventEntry,
  normalizeTaskLifecycleEventEntry,
};
