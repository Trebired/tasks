import type {
  TaskEventEntrySink,
  TaskHostEvent,
  TaskHostEventListener,
  TaskLifecycleEvent,
  TaskLifecycleEventListener,
} from "#2kjvrax0gr4m";
import {
  normalizeTaskHostEventEntry,
  normalizeTaskLifecycleEventEntry,
} from "./entry.js";

function createTaskHostEventAdapter(sink: TaskEventEntrySink<TaskHostEvent>): TaskHostEventListener {
  return async (event) => {
    await sink(normalizeTaskHostEventEntry(event), event);
  };
}

function createTaskLifecycleEventAdapter(
  sink: TaskEventEntrySink<TaskLifecycleEvent>,
): TaskLifecycleEventListener {
  return async (event) => {
    await sink(normalizeTaskLifecycleEventEntry(event), event);
  };
}

export {
  createTaskHostEventAdapter,
  createTaskLifecycleEventAdapter,
};
