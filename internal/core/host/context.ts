import { resolveLogger } from "@trebired/logger-adapter";

import {
  DEFAULT_TASK_GLOBAL_CONCURRENCY,
  DEFAULT_TASK_HEARTBEAT_MS,
  DEFAULT_TASK_LEASE_MS,
  DEFAULT_TASK_MAX_ATTEMPTS,
  DEFAULT_TASK_POLL_INTERVAL_MS,
  DEFAULT_TASK_STALE_SCAN_INTERVAL_MS,
  DEFAULT_TASK_STALE_SCAN_LIMIT,
  DEFAULT_TASK_STOP_TIMEOUT_MS,
  TASKS_LOG_GROUP,
} from "#5dtdwzlie8fm";
import type {
  TaskExecutionHandle,
  TaskExecutor,
  TaskHandlerRegistration,
  TaskHostEvent,
  TaskHostEventListener,
  TaskHostOptions,
  TaskHostState,
  TaskLifecycleEventListener,
  TaskRecord,
  TaskRetentionPolicy,
} from "#2kjvrax0gr4m";
import { createChildProcessTaskExecutor } from "#4bd798a4d972";
import { normalizeTaskHostEvent } from "#b3d930a4472b";
import { TaskEventEmitter } from "#cc76e7b18894";
import { taskId } from "#92c6666f713d";

type TimerHandle = ReturnType<typeof setInterval>;

export type RunningExecution = {
  taskId: string;
  task: TaskRecord;
  handle: TaskExecutionHandle;
  cancelRequested: boolean;
  heartbeatTimer: TimerHandle | null;
  settled: Promise<void>;
};

export type TaskHostContext = {
  store: TaskHostOptions["store"];
  executor: TaskExecutor;
  handlers: Map<string, TaskHandlerRegistration>;
  eventEmitter: TaskEventEmitter<TaskHostEventListener>;
  lifecycleEmitter: TaskEventEmitter<TaskLifecycleEventListener>;
  logger: ReturnType<typeof resolveLogger>;
  state: TaskHostState;
  runnerId: string;
  pollIntervalMs: number;
  heartbeatMs: number;
  leaseMs: number;
  globalConcurrency: number;
  staleScanIntervalMs: number;
  staleScanLimit: number;
  watchdogMs: number;
  watchdogScanIntervalMs: number;
  retentionPolicy: TaskRetentionPolicy | null;
  retentionScanIntervalMs: number;
  stopTimeoutMs: number;
  defaultMaxAttempts: number;
  pumpPromise: Promise<void> | null;
  pollTimer: TimerHandle | null;
  staleTimer: TimerHandle | null;
  watchdogTimer: TimerHandle | null;
  retentionTimer: TimerHandle | null;
  running: Map<string, RunningExecution>;
};

function createTaskHostContext(options: TaskHostOptions): TaskHostContext {
  return {
    store: options.store,
    executor: options.executor ?? createChildProcessTaskExecutor(),
    handlers: new Map((options.handlers || []).map((handler) => [handler.kind, handler])),
    eventEmitter: new TaskEventEmitter<TaskHostEventListener>(),
    lifecycleEmitter: new TaskEventEmitter<TaskLifecycleEventListener>(),
    logger: resolveLogger({
      logger: options.logger,
      adapter: options.loggerAdapter,
      source: TASKS_LOG_GROUP,
    }),
    state: "idle",
    runnerId: options.runner?.id || taskId(),
    pollIntervalMs: Math.max(50, options.runner?.pollIntervalMs ?? DEFAULT_TASK_POLL_INTERVAL_MS),
    heartbeatMs: Math.max(500, options.runner?.heartbeatMs ?? DEFAULT_TASK_HEARTBEAT_MS),
    leaseMs: Math.max(
      Math.max(500, options.runner?.heartbeatMs ?? DEFAULT_TASK_HEARTBEAT_MS) * 2,
      options.runner?.leaseMs ?? DEFAULT_TASK_LEASE_MS,
    ),
    globalConcurrency: Math.max(1, options.runner?.globalConcurrency ?? DEFAULT_TASK_GLOBAL_CONCURRENCY),
    staleScanIntervalMs: Math.max(1_000, options.runner?.staleScanIntervalMs ?? DEFAULT_TASK_STALE_SCAN_INTERVAL_MS),
    staleScanLimit: Math.max(1, options.runner?.staleScanLimit ?? DEFAULT_TASK_STALE_SCAN_LIMIT),
    watchdogMs: Math.max(0, options.runner?.watchdogMs ?? 0),
    watchdogScanIntervalMs: Math.max(
      1_000,
      options.runner?.watchdogScanIntervalMs ?? options.runner?.staleScanIntervalMs ?? DEFAULT_TASK_STALE_SCAN_INTERVAL_MS,
    ),
    retentionPolicy: options.runner?.retentionPolicy ?? null,
    retentionScanIntervalMs: Math.max(1_000, options.runner?.retentionScanIntervalMs ?? 60_000),
    stopTimeoutMs: Math.max(1_000, options.runner?.stopTimeoutMs ?? DEFAULT_TASK_STOP_TIMEOUT_MS),
    defaultMaxAttempts: Math.max(1, options.defaultMaxAttempts ?? DEFAULT_TASK_MAX_ATTEMPTS),
    pumpPromise: null,
    pollTimer: null,
    staleTimer: null,
    watchdogTimer: null,
    retentionTimer: null,
    running: new Map(),
  };
}

function emitTaskHostEvent(context: TaskHostContext, event: TaskHostEvent): void {
  context.eventEmitter.emit(event);
  const lifecycle = normalizeTaskHostEvent(event);
  if (lifecycle) {
    context.lifecycleEmitter.emit(lifecycle);
  }
}

function registerTaskHostHandler(context: TaskHostContext, handler: TaskHandlerRegistration): void {
  context.handlers.set(handler.kind, handler);
}

function getPerKindConcurrency(context: TaskHostContext): Record<string, number | undefined> {
  const limits: Record<string, number | undefined> = {};
  for (const [kind, handler] of context.handlers) {
    limits[kind] = handler.concurrency?.limit;
  }
  return limits;
}

export {
  createTaskHostContext,
  emitTaskHostEvent,
  getPerKindConcurrency,
  registerTaskHostHandler,
};
