import type {
  SqliteTaskStoreOptions,
  TaskStore,
} from "#2kjvrax0gr4m";
import { cancelTask } from "./cancel.js";
import { claimNextTask } from "./claim.js";
import { markTaskCancelled, markTaskFailed, requeueTask } from "./completion.js";
import { createTask } from "./create_task.js";
import { appendTaskStep, markTaskRunning, markTaskSucceeded, renewTaskLease, updateTaskProgress } from "./progress.js";
import { findTaskByDedupeKey, getTask, listTaskSteps, listTasks, summarizeTasks } from "./read.js";
import { applyRetentionPolicy } from "./retention.js";
import { createSqliteTaskContext } from "./shared.js";
import { markStaleTasks, requeueStaleTasks } from "./stale.js";

function createSqliteTaskStore(options: SqliteTaskStoreOptions): TaskStore {
  const context = createSqliteTaskContext(options);

  return {
    createTask: (input) => createTask(context, input),
    getTask: (taskId) => getTask(context, taskId),
    listTasks: (query) => listTasks(context, query),
    summarizeTasks: (query) => summarizeTasks(context, query),
    listTaskSteps: (taskId, query) => listTaskSteps(context, taskId, query),
    findTaskByDedupeKey: (input) => findTaskByDedupeKey(context, input),
    claimNextTask: (input) => claimNextTask(context, input),
    markTaskRunning: (input) => markTaskRunning(context, input),
    renewTaskLease: (input) => renewTaskLease(context, input),
    appendTaskStep: (input) => appendTaskStep(context, input),
    updateTaskProgress: (input) => updateTaskProgress(context, input),
    markTaskSucceeded: (input) => markTaskSucceeded(context, input),
    markTaskFailed: (input) => markTaskFailed(context, input),
    cancelTask: (input) => cancelTask(context, input),
    markTaskCancelled: (input) => markTaskCancelled(context, input),
    requeueTask: (input) => requeueTask(context, input),
    markStaleTasks: (input) => markStaleTasks(context, input),
    requeueStaleTasks: (input) => requeueStaleTasks(context, input),
    applyRetentionPolicy: (policy) => applyRetentionPolicy(context, policy),
  };
}

export {
  createSqliteTaskStore,
};
