import {
  createTaskLiveHub,
  createTaskLiveTracker,
  taskChannel,
} from "#8t8bq600b4wu";
import { resolveLogger } from "@package/logger-adapter";

const log = resolveLogger({ source: "@trebired/tasks" });

async function subscribeToDemoUpdates(
  hub: ReturnType<typeof createTaskLiveHub>,
  tracker: ReturnType<typeof createTaskLiveTracker>,
) {
  await hub.subscribe(
    {
      channels: [taskChannel.scope("workspace:demo")],
      recentSteps: 10,
    },
    (message) => {
      const state = tracker.apply(message);
      const current = state.snapshots[0];
      if (current) {
        log.info("example.live.demo.subscription", "task update", {
            state: current.state,
            percent: current.progress.percent,
            label: current.progress.label,
        });
      }
    },
  );
}

export { subscribeToDemoUpdates };
