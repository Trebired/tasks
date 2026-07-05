class TaskEventEmitter<TListener extends (value: any) => void | Promise<void>> {
  #listeners = new Set<TListener>();

  add(listener: TListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  emit(event: Parameters<TListener>[0]): void {
    for (const listener of this.#listeners) {
      try {
        void listener(event);
      } catch {
        // Listener failures must not stop task processing.
      }
    }
  }
}

export {
  TaskEventEmitter,
};
