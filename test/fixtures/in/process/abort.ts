import { setTimeout as delay } from "node:timers/promises";

export default {
  async run(_input: unknown, context: {
    appendStep: (input: {
      message?: string;
      level?: string;
    }) => Promise<void>;
    signal: AbortSignal;
  }) {
    await context.appendStep({
      level: "info",
      message: "waiting",
    });

    while (!context.signal.aborted) {
      await delay(5);
    }

    throw context.signal.reason ?? new DOMException("Aborted", "AbortError");
  },
};
