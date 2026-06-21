import { matchesTaskQuery } from "#ir9grtwyf3f1";
import { nowIso } from "#qysd2ddsh0x8";
import type {
  TaskHost,
  TaskLiveHub,
  TaskLiveMessage,
  TaskSubscriptionBootstrap,
  TaskSubscriptionQuery,
} from "#2kjvrax0gr4m";

async function createSubscriptionBootstrap(host: TaskHost, query: TaskSubscriptionQuery = {}): Promise<TaskSubscriptionBootstrap> {
  const snapshots = await host.listSnapshots({
    taskIds: query.taskIds,
    kinds: query.kinds,
    statuses: query.statuses,
    channels: query.channels,
    states: query.states,
    limit: query.limit,
    includeSteps: null,
  });

  const limited = typeof query.limit === "number" && query.limit > 0
    ? snapshots.slice(0, query.limit)
    : snapshots;

  const recentSteps = typeof query.recentSteps === "number" && query.recentSteps > 0
    ? await Promise.all(limited.map(async (snapshot) => [
      snapshot.taskId,
      await host.listTaskSteps(snapshot.taskId, {
        limit: query.recentSteps || undefined,
      }),
    ] as const))
    : [];

  return {
    type: "bootstrap",
    timestamp: nowIso(),
    query,
    snapshots: limited,
    steps: Object.fromEntries(recentSteps),
    aggregate: query.includeAggregate === false
      ? null
      : await host.readAggregate({
        kinds: query.kinds,
        statuses: query.statuses,
        channels: query.channels,
      }),
  };
}

function createTaskLiveHub(host: TaskHost): TaskLiveHub {
  return {
    async bootstrap(query: TaskSubscriptionQuery = {}) {
      return createSubscriptionBootstrap(host, query);
    },
    async subscribe(query: TaskSubscriptionQuery = {}, listener) {
      await listener(await createSubscriptionBootstrap(host, query));

      const unsubscribe = host.onLifecycleEvent(async (event) => {
        if (event.snapshot && !matchesTaskQuery(event.snapshot, query)) {
          return;
        }

        const message: TaskLiveMessage = {
          type: "event",
          timestamp: nowIso(),
          event,
        };
        await listener(message);
      });

      return unsubscribe;
    },
  };
}

export {
  createSubscriptionBootstrap,
  createTaskLiveHub,
};
