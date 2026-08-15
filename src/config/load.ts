import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PACKAGE_VERSION } from "#44ds7phbcz8i";
import type {
  LoadedTasksConfig,
  LoadTasksConfigOptions,
  NormalizedTasksConfig,
  TasksConfig,
} from "./types.js";
import { defineConfig, normalizeConfig } from "./normalize.js";

const TASKS_PROJECT_CONFIG_PATH = ".trebired/tasks/config.ts";
const EMPTY_CONFIG = Object.freeze(normalizeConfig(
    { forVersion: PACKAGE_VERSION },
    { requireForVersion: false },
));

let cachedConfigs = new Map<string, LoadedTasksConfig>();

async function loadConfig(projectRoot = process.cwd(), options: LoadTasksConfigOptions = {}): Promise<LoadedTasksConfig> {
  const root = path.resolve(projectRoot);
  const configPath = options.configPath
  ? path.resolve(root, options.configPath)
  : await findConfig(options.searchFrom || root, root);
  if (!configPath) return handleMissingConfig(options);
  if (!await pathExists(configPath)) throw new Error(`tasks config was not found: ${configPath}`);
  return loadedConfig(configPath, readSourceConfig(await fsPromises.readFile(configPath, "utf8"), configPath));
}

function loadConfigSync(projectRoot = process.cwd(), options: LoadTasksConfigOptions = {}): LoadedTasksConfig {
  const root = path.resolve(projectRoot);
  const configPath = options.configPath
  ? path.resolve(root, options.configPath)
  : findConfigSync(options.searchFrom || root, root);
  if (!configPath) return handleMissingConfig(options);
  if (!fs.existsSync(configPath)) throw new Error(`tasks config was not found: ${configPath}`);
  return loadedConfig(configPath, readSourceConfig(fs.readFileSync(configPath, "utf8"), configPath));
}

function loadCachedConfigSync(projectRoot = process.cwd()): NormalizedTasksConfig {
  const root = path.resolve(projectRoot);
  const configPath = findConfigSync(root);
  const cacheKey = configPath || `missing:${root}`;
  const cached = cachedConfigs.get(cacheKey);
  if (cached) return cached.config;
  const loaded = configPath ? loadConfigSync(root, { configPath }) : missingConfig();
  cachedConfigs.set(cacheKey, loaded);
  return loaded.config;
}

function resetConfigCacheForTests(): void {
  cachedConfigs = new Map<string, LoadedTasksConfig>();
}

async function findConfig(startDir = process.cwd(), boundaryDir?: string): Promise<string|null> {
  let current = path.resolve(startDir);
  const boundary = boundaryDir ? path.resolve(boundaryDir) : "";
  for (;; ) {
    const candidate = path.join(current, TASKS_PROJECT_CONFIG_PATH);
    if (await pathExists(candidate)) return candidate;
    if (boundary && current === boundary) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function findConfigSync(startDir = process.cwd(), boundaryDir?: string): string | null {
  let current = path.resolve(startDir);
  const boundary = boundaryDir ? path.resolve(boundaryDir) : "";
  for (;; ) {
    const candidate = path.join(current, TASKS_PROJECT_CONFIG_PATH);
    if (fs.existsSync(candidate)) return candidate;
    if (boundary && current === boundary) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath);
    return true;
  }
  catch {
    return false;
  }
}

function handleMissingConfig(options: LoadTasksConfigOptions): LoadedTasksConfig {
  if (options.defaultIfMissing === false) throw new Error("tasks config was not found");
  return missingConfig();
}

function missingConfig(): LoadedTasksConfig {
  return { config: EMPTY_CONFIG, configPath: null, dependencies: [] };
}

function loadedConfig(configPath: string, config: TasksConfig): LoadedTasksConfig {
  return {
    config: normalizeConfig(config, { configPath, requireForVersion: true }),
    configPath,
    dependencies: [configPath],
  };
}

function readSourceConfig(source: string, configPath: string): TasksConfig {
  const candidate = runConfigSource(source, configPath);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`tasks config must default-export an object: ${configPath}`);
  }
  return candidate as TasksConfig;
}

function runConfigSource(source: string, configPath: string): unknown {
  try {
    return Function("defineConfig", `${toRuntimeConfigSource(source, configPath)}\n//# sourceURL=${pathToFileURL(configPath).href}`)(defineConfig);
  }
  catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`tasks config failed to load: ${configPath}: ${reason}`);
  }
}

function toRuntimeConfigSource(source: string, configPath: string): string {
  const withoutImports = source
  .replace(/^\s*import\s+type\s+[\s\S]*?\s+from\s+["'][^"']+["'];?\s*$/gmu, "")
  .replace(/^\s*import\s+[\s\S]*?\s+from\s+["'][^"']+["'];?\s*$/gmu, "")
  .replace(/^\s*import\s+["'][^"']+["'];?\s*$/gmu, "");
  const runtimeSource = withoutImports.replace(/\bexport\s+default\b/u, "return");
  if (runtimeSource === withoutImports || /\bexport\b/u.test(runtimeSource)) {
    throw new Error(`tasks config only supports a default export: ${configPath}`);
  }
  return runtimeSource;
}

export {
  TASKS_PROJECT_CONFIG_PATH,
  findConfig,
  findConfigSync,
  loadCachedConfigSync,
  loadConfig,
  loadConfigSync,
  resetConfigCacheForTests,
};
