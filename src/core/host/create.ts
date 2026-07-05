import type {
  TaskHost,
  TaskHostOptions,
  TaskRecord,
} from "#2kjvrax0gr4m";
import { cancelTask, enqueueTask } from "./control.js";
import {
  createTaskHostContext,
  registerTaskHostHandler,
} from "./context.js";
import { startTaskHost, stopTaskHost } from "./lifecycle.js";
import {
  bootstrapTaskSubscription,
  compactTaskHistory,
  listTaskSnapshots,
  readTaskAggregate,
  readTaskSnapshot,
} from "./query.js";
import { scheduleTaskHostPump } from "./pump.js";
import { startTaskExecution } from "./execution.js";

function createTaskHost(options: TaskHostOptions): TaskHost {
  const context = createTaskHostContext(options);
  const schedulePump = () => scheduleTaskHostPump(context, (task, handler) => startTaskExecution(context, task, handler, schedulePump));

  const host: TaskHost = {
    start: () => startTaskHost(context),
    stop: () => stopTaskHost(context),
    getState: () => context.state,
    registerHandler(handler) {
      registerTaskHostHandler(context, handler);
      return host;
    },
    async enqueue(kind, input, enqueueOptions) {
      const result = await enqueueTask(context, kind, input, enqueueOptions);
      await schedulePump();
      return result;
    },
    getTask: <TInput = unknown, TResult = unknown>(taskId: string) => context.store.getTask<TInput, TResult>(taskId),
    listTasks: <TInput = unknown, TResult = unknown>(query) => context.store.listTasks<TInput, TResult>(query),
    listTaskSteps: (taskId, query) => context.store.listTaskSteps(taskId, query),
    readSnapshot: (taskId, readOptions) => readTaskSnapshot(context, taskId, readOptions),
    listSnapshots: (query) => listTaskSnapshots(context, query),
    readAggregate: (query) => readTaskAggregate(context, query),
    bootstrap: (query) => bootstrapTaskSubscription(context, query),
    compact: (policy) => compactTaskHistory(context, policy),
    cancel: (taskId, reason) => cancelTask(context, taskId, reason),
    onEvent: (listener) => context.eventEmitter.add(listener),
    onLifecycleEvent: (listener) => context.lifecycleEmitter.add(listener),
  };

  if (options.onEvent) {
    host.onEvent(options.onEvent);
  }

  if (options.onLifecycleEvent) {
    host.onLifecycleEvent(options.onLifecycleEvent);
  }

  return host;
}

export {
  createTaskHost,
};
