import {
  createTaskLiveHub,
  createTaskLiveTracker,
  taskChannel,
} from "#8t8bq600b4wu";

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
        console.log(
          current.state,
          current.progress.percent,
          current.progress.label,
        );
      }
    },
  );
}

export { subscribeToDemoUpdates };
