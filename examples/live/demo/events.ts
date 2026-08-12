import type { TaskExecutorRunRequest } from "#2kjvrax0gr4m";

async function emitLiveDemoEvents(
  request: Pick<TaskExecutorRunRequest, "onEvent">,
) {
  await request.onEvent?.({
      type: "progress",
      progress: {
        percent: 30,
        label: "loading",
      },
  });
  await request.onEvent?.({
      type: "step",
      step: {
        message: "Source loaded",
        percent: 30,
      },
  });
  await request.onEvent?.({
      type: "progress",
      progress: {
        percent: 100,
        label: "done",
      },
  });
}

export { emitLiveDemoEvents };
