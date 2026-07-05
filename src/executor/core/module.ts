import { pathToFileURL } from "node:url";

import type {
  InProcessTaskModuleLoader,
  TaskHandlerEntrypoint,
  TaskHandlerModule,
} from "#2kjvrax0gr4m";

function resolveTaskModuleSpecifier(input: string | URL): string {
  if (input instanceof URL) {
    return input.href;
  }

  if (input.startsWith("file://") || input.startsWith("data:") || input.startsWith("node:")) {
    return input;
  }

  if (input.startsWith("/") || input.startsWith(".")) {
    return pathToFileURL(input).href;
  }

  return input;
}

function resolveTaskHandlerExport(mod: Record<string, unknown>, exportName?: string): TaskHandlerModule {
  const candidate = exportName ? mod[exportName] : mod.default ?? mod.handler ?? mod;

  if (typeof candidate === "function") {
    return {
      run: candidate as TaskHandlerModule["run"],
    };
  }

  if (candidate && typeof candidate === "object" && typeof (candidate as TaskHandlerModule).run === "function") {
    return candidate as TaskHandlerModule;
  }

  throw new Error(`Handler export "${exportName || "default"}" does not expose a run() function`);
}

async function defaultTaskModuleLoader(specifier: string): Promise<Record<string, unknown>> {
  return await import(specifier) as Record<string, unknown>;
}

async function loadTaskHandlerModule(
  entrypoint: Pick<TaskHandlerEntrypoint, "module" | "export">,
  loadModule: InProcessTaskModuleLoader = defaultTaskModuleLoader,
): Promise<TaskHandlerModule> {
  const specifier = resolveTaskModuleSpecifier(entrypoint.module);
  const mod = await loadModule(specifier);
  return resolveTaskHandlerExport(mod, entrypoint.export);
}

export {
  defaultTaskModuleLoader,
  loadTaskHandlerModule,
  resolveTaskHandlerExport,
  resolveTaskModuleSpecifier,
};
