export const handler = {
  async run() {
    const error = new Error("boom");
    (error as Error & {
      code?: string;
      details?: Record<string, unknown>;
    }).code = "EFAIL";
    (error as Error & {
      code?: string;
      details?: Record<string, unknown>;
    }).details = {
      source: "fixture",
    };
    throw error;
  },
};
