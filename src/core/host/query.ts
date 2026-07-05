import type {
  TaskAggregateSnapshot,
  TaskRecord,
  TaskRetentionPolicy,
  TaskRetentionResult,
  TaskSnapshot,
  TaskSnapshotQuery,
  TaskStepRecord,
  TaskSubscriptionBootstrap,
  TaskSubscriptionQuery,
} from "#2kjvrax0gr4m";
import { buildTaskAggregateSnapshot, createTaskSnapshot, matchesTaskQuery } from "#657abf96f340";
import { nowIso } from "#92c6666f713d";
import type { TaskHostContext } from "./context.js";

type TaskSnapshotWithSteps<TInput = unknown, TResult = unknown> = TaskSnapshot<TInput, TResult> & {
  steps?: TaskStepRecord[];
};

async function readTaskSnapshot<TInput = unknown, TResult = unknown>(
  context: TaskHostContext,
  taskId: string,
  options: { includeSteps?: number | null } = {},
): Promise<TaskSnapshotWithSteps<TInput, TResult> | null> {
  const task = await context.store.getTask<TInput, TResult>(taskId);
  if (!task) {
    return null;
  }

  const snapshot = createTaskSnapshot(task);
  const steps = await readIncludedSteps(context, taskId, options.includeSteps);
  return steps ? { ...snapshot, steps } : snapshot;
}

async function listTaskSnapshots<TInput = unknown, TResult = unknown>(
  context: TaskHostContext,
  query: TaskSnapshotQuery = {},
): Promise<TaskSnapshotWithSteps<TInput, TResult>[]> {
  const tasks = await context.store.listTasks<TInput, TResult>({
    taskIds: query.taskIds,
    kinds: query.kinds,
    statuses: query.statuses,
    channels: query.channels,
    concurrencyKey: query.concurrencyKey,
    dedupeKey: query.dedupeKey,
    supersedeKey: query.supersedeKey,
    limit: query.limit,
    offset: query.offset,
    orderBy: query.orderBy,
  });

  const filtered = tasks
    .map((task) => createTaskSnapshot(task))
    .filter((snapshot) => matchesTaskQuery(snapshot, query));

  return attachStepsToSnapshots(context, filtered, query.includeSteps) as Promise<TaskSnapshotWithSteps<TInput, TResult>[]>;
}

async function readTaskAggregate(context: TaskHostContext, query: TaskSnapshotQuery = {}): Promise<TaskAggregateSnapshot> {
  const base = await context.store.summarizeTasks({
    taskIds: query.taskIds,
    kinds: query.kinds,
    statuses: query.statuses,
    channels: query.channels,
    concurrencyKey: query.concurrencyKey,
    dedupeKey: query.dedupeKey,
    supersedeKey: query.supersedeKey,
    limit: query.limit,
    offset: query.offset,
    orderBy: query.orderBy,
  });

  if (!query.states?.length) {
    return base;
  }

  return buildTaskAggregateSnapshot(await listTaskSnapshots(context, query));
}

async function bootstrapTaskSubscription(
  context: TaskHostContext,
  query: TaskSubscriptionQuery = {},
): Promise<TaskSubscriptionBootstrap> {
  const snapshots = await listTaskSnapshots(context, {
    taskIds: query.taskIds,
    kinds: query.kinds,
    statuses: query.statuses,
    channels: query.channels,
    states: query.states,
    concurrencyKey: query.concurrencyKey,
    dedupeKey: query.dedupeKey,
    supersedeKey: query.supersedeKey,
    limit: query.limit,
  });

  return {
    type: "bootstrap",
    timestamp: nowIso(),
    query,
    snapshots,
    steps: await buildBootstrapSteps(context, snapshots, query.recentSteps),
    aggregate: query.includeAggregate === false ? null : buildTaskAggregateSnapshot(snapshots),
  };
}

async function compactTaskHistory(
  context: TaskHostContext,
  policy?: TaskRetentionPolicy | null,
): Promise<TaskRetentionResult> {
  const resolved = policy ?? context.retentionPolicy;
  if (!resolved) {
    return {
      deletedTasks: 0,
      deletedSteps: 0,
      compactedTasks: 0,
    };
  }

  return context.store.applyRetentionPolicy(resolved);
}

async function readIncludedSteps(
  context: TaskHostContext,
  taskId: string,
  includeSteps?: number | null,
): Promise<TaskStepRecord[] | undefined> {
  if (typeof includeSteps !== "number" || includeSteps <= 0) {
    return undefined;
  }

  return context.store.listTaskSteps(taskId, {
    limit: includeSteps,
  });
}

async function attachStepsToSnapshots(
  context: TaskHostContext,
  snapshots: TaskSnapshot[],
  includeSteps?: number | null,
): Promise<Array<TaskSnapshot & { steps?: TaskStepRecord[] }>> {
  if (typeof includeSteps !== "number" || includeSteps <= 0) {
    return snapshots;
  }

  return Promise.all(snapshots.map(async (snapshot) => ({
    ...snapshot,
    steps: await context.store.listTaskSteps(snapshot.taskId, {
      limit: includeSteps,
    }),
  })));
}

async function buildBootstrapSteps(
  context: TaskHostContext,
  snapshots: TaskSnapshot[],
  recentSteps?: number | null,
): Promise<Record<string, TaskStepRecord[]>> {
  if (typeof recentSteps !== "number" || recentSteps <= 0) {
    return {};
  }

  return Object.fromEntries(await Promise.all(snapshots.map(async (snapshot) => [
    snapshot.taskId,
    await context.store.listTaskSteps(snapshot.taskId, {
      limit: recentSteps,
    }),
  ] as const)));
}

export {
  bootstrapTaskSubscription,
  compactTaskHistory,
  listTaskSnapshots,
  readTaskAggregate,
  readTaskSnapshot,
};
