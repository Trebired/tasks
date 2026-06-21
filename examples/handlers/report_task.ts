import { defineTaskHandler } from "../../src/index";

export default defineTaskHandler<{ reportId: string }, { outputPath: string }>({
  async run(input, context) {
    await context.setProgress({
      percent: 5,
      label: "starting",
      meta: {
        reportId: input.reportId,
      },
    });

    await context.appendStep({
      message: `Preparing report ${input.reportId}`,
      level: "info",
    });

    await new Promise((resolve) => setTimeout(resolve, 250));

    await context.setProgress({
      percent: 60,
      label: "rendering",
    });

    await new Promise((resolve) => setTimeout(resolve, 250));

    await context.appendStep({
      message: "Report persisted",
      level: "success",
      percent: 100,
    });

    return {
      outputPath: `/tmp/reports/${input.reportId}.json`,
    };
  },
});
