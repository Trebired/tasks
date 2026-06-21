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
  let state: TaskLiveTrackerState = {
    snapshots: [],
    steps: {},
    aggregate: null,
    updatedAt: null,
  };

  return {
    apply(message: TaskLiveMessage): TaskLiveTrackerState {
      if (message.type === "bootstrap") {
        state = {
          snapshots: sortSnapshots(message.snapshots),
          steps: message.steps,
          aggregate: message.aggregate,
          updatedAt: message.timestamp,
        };
        emitter.emit(state);
        return state;
      }

      const event = message.event;
      let snapshots = state.snapshots;
      let steps = {
        ...state.steps,
      };

      if (event.snapshot) {
        const others = snapshots.filter((snapshot) => snapshot.taskId !== event.snapshot?.taskId);
        snapshots = sortSnapshots([event.snapshot, ...others]);
      }

      if (event.step) {
        const existing = steps[event.taskId] || [];
        steps[event.taskId] = [...existing, event.step];
      }

      const aggregate = state.aggregate
        ? buildTaskAggregateSnapshot(snapshots)
        : state.aggregate;

      state = {
        snapshots,
        steps,
        aggregate,
        updatedAt: message.timestamp,
      };

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

export {
  createTaskLiveTracker,
};
