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
  return host.bootstrap(query);
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
