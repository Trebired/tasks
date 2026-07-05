import type {
  TaskLiveMessage,
  TaskLiveTracker,
  TaskLiveTrackerState,
  TaskSnapshot,
} from "#2kjvrax0gr4m";
import { TaskEventEmitter } from "#dagzoln5nq38";
import { buildTaskAggregateSnapshot } from "#ir9grtwyf3f1";

function sortSnapshots(snapshots: TaskSnapshot[]): TaskSnapshot[] {
  return [...snapshots].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function createTaskLiveTracker(): TaskLiveTracker {
  const emitter = new TaskEventEmitter<(state: TaskLiveTrackerState) => void>();
  let state = createInitialTrackerState();

  return {
    apply(message: TaskLiveMessage): TaskLiveTrackerState {
      state = message.type === "bootstrap"
        ? applyBootstrapMessage(message)
        : applyLiveEventMessage(state, message);
      emitter.emit(state);
      return state;
    },
    getState() {
      return state;
    },
    onChange(listener) {
      return emitter.add(listener);
    },
  };
}

function createInitialTrackerState(): TaskLiveTrackerState {
  return {
    snapshots: [],
    steps: {},
    aggregate: null,
    updatedAt: null,
  };
}

function applyBootstrapMessage(message: Extract<TaskLiveMessage, {
  type: "bootstrap";
}>): TaskLiveTrackerState {
  return {
    snapshots: sortSnapshots(message.snapshots),
    steps: message.steps,
    aggregate: message.aggregate,
    updatedAt: message.timestamp,
  };
}

function applyLiveEventMessage(
  state: TaskLiveTrackerState,
  message: Extract<TaskLiveMessage, {
    type: "event";
  }>,
): TaskLiveTrackerState {
  const snapshots = applySnapshotUpdate(state.snapshots, message);
  const steps = applyStepUpdate(state.steps, message);

  return {
    snapshots,
    steps,
    aggregate: state.aggregate ? buildTaskAggregateSnapshot(snapshots) : state.aggregate,
    updatedAt: message.timestamp,
  };
}

function applySnapshotUpdate(
  snapshots: TaskSnapshot[],
  message: Extract<TaskLiveMessage, {
    type: "event";
  }>,
): TaskSnapshot[] {
  if (!message.event.snapshot) {
    return snapshots;
  }

  const others = snapshots.filter((snapshot) => snapshot.taskId !== message.event.snapshot?.taskId);
  return sortSnapshots([message.event.snapshot, ...others]);
}

function applyStepUpdate(
  steps: TaskLiveTrackerState["steps"],
  message: Extract<TaskLiveMessage, {
    type: "event";
  }>,
): TaskLiveTrackerState["steps"] {
  if (!message.event.step) {
    return {
      ...steps,
    };
  }

  const existing = steps[message.event.taskId] || [];
  return {
    ...steps,
    [message.event.taskId]: [...existing, message.event.step],
  };
}

export {
  createTaskLiveTracker,
};
