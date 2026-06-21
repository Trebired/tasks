import type {
  TaskLiveSocketBridgeOptions,
  TaskLiveSocketServerLike,
  TaskSubscriptionQuery,
} from "#2kjvrax0gr4m";

function attachTaskLiveSocketBridge(
  server: TaskLiveSocketServerLike,
  options: TaskLiveSocketBridgeOptions,
): void {
  const subscribeEvent = options.subscribeEvent || "tasks:subscribe";
  const unsubscribeEvent = options.unsubscribeEvent || "tasks:unsubscribe";
  const publishEvent = options.publishEvent || "tasks:live";

  server.on("connection", (socket) => {
    const subscriptions = new Map<string, () => void>();

    socket.on(subscribeEvent, async (...args: unknown[]) => {
      const payload = (args[0] || {}) as {
        id?: string;
        query?: TaskSubscriptionQuery;
      };
      const id = payload.id || "default";

      const existing = subscriptions.get(id);
      if (existing) {
        existing();
        subscriptions.delete(id);
      }

      const unsubscribe = await options.hub.subscribe(payload.query || {}, (message) => {
        socket.emit(publishEvent, {
          id,
          ...message,
        });
      });

      subscriptions.set(id, unsubscribe);
    });

    socket.on(unsubscribeEvent, (...args: unknown[]) => {
      const payload = (args[0] || {}) as {
        id?: string;
      };
      const id = payload.id || "default";
      const unsubscribe = subscriptions.get(id);
      if (!unsubscribe) {
        return;
      }
      unsubscribe();
      subscriptions.delete(id);
    });
  });
}

export {
  attachTaskLiveSocketBridge,
};
