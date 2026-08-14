import type {
  NormalizedTasksConfig,
  TasksConfig,
  TasksStoreOptions,
} from "./types.js";
import type { TaskHostOptions, TaskRetryBackoff } from "#2kjvrax0gr4m";

function defineConfig<TConfig extends TasksConfig>(config: TConfig): TConfig {
  return config;
}

function normalizeConfig(config: TasksConfig = {}): NormalizedTasksConfig {
  if (!isRecord(config)) throw new Error("tasks config must be an object");
  return {
    defaults: normalizeDefaults(config.defaults),
    runner: normalizeRunner(config.runner),
    storage: normalizeStorage(config.storage),
  };
}

function mergeTaskHostOptions(config: NormalizedTasksConfig, options: TaskHostOptions): TaskHostOptions {
  return {
    ...options,
    defaultMaxAttempts: options.defaultMaxAttempts ?? config.defaults.maxAttempts,
    runner: {
      ...config.runner,
      ...(options.runner || {}),
    },
  };
}

function mergeTaskStoreOptions<TOptions extends TasksStoreOptions>(
  config: NormalizedTasksConfig,
  options: TOptions,
): TOptions {
  if (options.driver === "postgres") {
    return {
      ...options,
      postgres: {
        ...(config.storage.postgres || {}),
        ...(options.postgres || {}),
      },
    } as TOptions;
  }

  return {
    ...options,
    sqlite: {
      ...(config.storage.sqlite || {}),
      ...(options.sqlite || {}),
    },
  } as TOptions;
}

function mergeRetryBackoff(
  config: NormalizedTasksConfig,
  backoff?: TaskRetryBackoff | null,
): TaskRetryBackoff | undefined {
  return {
    ...(config.defaults.retryBackoff || {}),
    ...(backoff || {}),
  };
}

function normalizeDefaults(input: TasksConfig["defaults"]): NormalizedTasksConfig["defaults"] {
  if (!isRecord(input)) return {};
  return {
    maxAttempts: normalizePositiveNumber(input.maxAttempts),
    retryBackoff: normalizeRetryBackoff(input.retryBackoff),
  };
}

function normalizeRunner(input: TasksConfig["runner"]): NormalizedTasksConfig["runner"] {
  if (!isRecord(input)) return {};
  return pickDefined({
      globalConcurrency: normalizePositiveNumber(input.globalConcurrency),
      heartbeatMs: normalizePositiveNumber(input.heartbeatMs),
      id: normalizeString(input.id),
      leaseMs: normalizePositiveNumber(input.leaseMs),
      pollIntervalMs: normalizePositiveNumber(input.pollIntervalMs),
      retentionScanIntervalMs: normalizePositiveNumber(input.retentionScanIntervalMs),
      staleScanIntervalMs: normalizePositiveNumber(input.staleScanIntervalMs),
      staleScanLimit: normalizePositiveNumber(input.staleScanLimit),
      stopTimeoutMs: normalizePositiveNumber(input.stopTimeoutMs),
      watchdogMs: normalizeNumber(input.watchdogMs),
      watchdogScanIntervalMs: normalizePositiveNumber(input.watchdogScanIntervalMs),
  });
}

function normalizeStorage(input: TasksConfig["storage"]): NormalizedTasksConfig["storage"] {
  if (!isRecord(input)) return {};
  return {
    postgres: normalizePostgres(input.postgres),
    sqlite: normalizeSqlite(input.sqlite),
  };
}

function normalizePostgres(input: TasksConfig["storage"] extends { postgres?: infer T } ? T : never) {
  if (!isRecord(input)) return undefined;
  return pickDefined({
      schema: normalizeString(input.schema),
      tablePrefix: normalizeString(input.tablePrefix),
  });
}

function normalizeSqlite(input: TasksConfig["storage"] extends { sqlite?: infer T } ? T : never) {
  if (!isRecord(input)) return undefined;
  return pickDefined({
      busyTimeoutMs: normalizeNumber(input.busyTimeoutMs),
      path: normalizeString(input.path),
      pragmas: normalizeStringList(input.pragmas),
      tablePrefix: normalizeString(input.tablePrefix),
  });
}

function normalizeRetryBackoff(input: unknown): TaskRetryBackoff | undefined {
  if (!isRecord(input)) return undefined;
  return pickDefined({
      factor: normalizeNumber(input.factor),
      jitter: normalizeNumber(input.jitter),
      maxDelayMs: normalizePositiveNumber(input.maxDelayMs),
      minDelayMs: normalizePositiveNumber(input.minDelayMs),
  });
}

function normalizePositiveNumber(value: unknown): number | undefined {
  const normalized = normalizeNumber(value);
  return normalized === undefined ? undefined : Math.max(1, normalized);
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeString(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

function normalizeStringList(value: unknown): string[] | undefined {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const normalized = Array.from(new Set(values.map(normalizeString).filter(Boolean) as string[]));
  return normalized.length > 0 ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pickDefined<TValue extends Record<string, unknown>>(input: TValue): Partial<TValue> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<TValue>;
}

export {
  defineConfig,
  mergeRetryBackoff,
  mergeTaskHostOptions,
  mergeTaskStoreOptions,
  normalizeConfig,
};
