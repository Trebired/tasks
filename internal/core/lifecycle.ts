import type {
  TaskEnqueueDisposition,
  TaskHostEvent,
  TaskLifecycleEvent,
  TaskLifecycleEventName,
  TaskRecord,
  TaskSnapshot,
  TaskStepRecord,
} from "#2kjvrax0gr4m";
import { createTaskSnapshot } from "./snapshot.js";

function taskSnapshotOrNull(task?: TaskRecord | null): TaskSnapshot | null {
  return task ? createTaskSnapshot(task) : null;
}

function taskChannelsOrEmpty(task?: TaskRecord | null): string[] {
  return task ? createTaskSnapshot(task).channels : [];
}

function mapLifecycleEventName(type: TaskHostEvent["type"]): TaskLifecycleEventName | null {
  switch (type) {
    case "task:enqueued":
      return "enqueued";
    case "task:claimed":
      return "claimed";
    case "task:running":
      return "started";
    case "task:progress":
      return "progress";
    case "task:step":
      return "step";
    case "task:retry":
      return "retried";
    case "task:succeeded":
      return "succeeded";
    case "task:failed":
      return "failed";
    case "task:cancelled":
      return "cancelled";
    case "task:stale":
      return "stale";
    case "task:lease_lost":
      return "lease_lost";
    default:
      return null;
  }
}

function createTaskLifecycleEvent(input: {
  event: TaskLifecycleEventName;
  timestamp: string;
  runnerId: string;
  taskId: string;
  kind: string;
  task?: TaskRecord | null;
  step?: TaskStepRecord | null;
  disposition?: TaskEnqueueDisposition;
  supersededTaskIds?: string[];
  error?: unknown;
  output?: unknown;
}): TaskLifecycleEvent {
  return {
    type: "task.lifecycle",
    event: input.event,
    timestamp: input.timestamp,
    runnerId: input.runnerId,
    taskId: input.taskId,
    kind: input.kind,
    snapshot: taskSnapshotOrNull(input.task),
    step: input.step ?? null,
    channels: taskChannelsOrEmpty(input.task),
    disposition: input.disposition,
    supersededTaskIds: input.supersededTaskIds,
    error: input.error,
    output: input.output,
  };
}

function normalizeTaskHostEvent(event: TaskHostEvent): TaskLifecycleEvent | null {
  if (!event.type.startsWith("task:")) {
    return null;
  }

  if (event.type === "task:stale_requeued") {
    return null;
  }

  const taskEvent = event as Extract<TaskHostEvent, {
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
  }>;

  const lifecycle = mapLifecycleEventName(taskEvent.type);
  if (!lifecycle) {
    return null;
  }

  return createTaskLifecycleEvent({
    event: lifecycle,
    timestamp: taskEvent.timestamp,
    runnerId: taskEvent.runnerId,
    taskId: taskEvent.taskId,
    kind: taskEvent.kind,
    task: taskEvent.task,
    step: taskEvent.step,
    disposition: taskEvent.disposition,
    supersededTaskIds: taskEvent.supersededTaskIds,
    error: taskEvent.error,
    output: taskEvent.output,
  });
}

export {
  createTaskLifecycleEvent,
  normalizeTaskHostEvent,
};
