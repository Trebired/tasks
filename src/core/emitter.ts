import type { TaskHostEvent, TaskHostEventListener } from "../types.js";

class TaskEventEmitter {
  #listeners = new Set<TaskHostEventListener>();

  add(listener: TaskHostEventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  emit(event: TaskHostEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // Listener failures must not stop task processing.
      }
    }
  }
}

export {
  TaskEventEmitter,
};
