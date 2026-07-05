export default {
  async run(input: {
    value: string;
  }, context: {
    setProgress: (input: {
      percent?: number | null;
      label?: string | null;
      meta?: Record<string, unknown> | null;
    }) => Promise<void>;
    appendStep: (input: {
      message?: string;
      level?: string;
      percent?: number | null;
      meta?: Record<string, unknown> | null;
    }) => Promise<void>;
    signal: AbortSignal;
  }) {
    await context.setProgress({
      percent: 25,
      label: "loading",
      meta: {
        value: input.value,
      },
    });

    await context.appendStep({
      level: "info",
      message: "Halfway there",
      percent: 50,
      meta: {
        signalAborted: context.signal.aborted,
      },
    });

    return {
      echoed: input.value,
    };
  },
};
