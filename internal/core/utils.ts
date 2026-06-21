import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import type { TaskTerminalError } from "#2kjvrax0gr4m";

function nowIso(value?: string | Date | number | null): string {
  if (value == null) {
    return new Date().toISOString();
  }

  if (typeof value === "string") {
    return new Date(value).toISOString();
  }

  return new Date(value).toISOString();
}

function taskId(value?: string | null): string {
  return value || randomUUID();
}

function leaseToken(): string {
  return randomUUID();
}

function sleep(ms: number): Promise<void> {
  return delay(ms).then(() => undefined);
}

function clampPercent(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) {
    return null;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 100) {
    return 100;
  }

  return value;
}

function toErrorShape(error: unknown, fallbackMessage = "Task execution failed"): TaskTerminalError {
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return {
      message: typeof value.message === "string" && value.message ? value.message : fallbackMessage,
      name: typeof value.name === "string" ? value.name : undefined,
      code: typeof value.code === "string" ? value.code : undefined,
      stack: typeof value.stack === "string" ? value.stack : undefined,
      details: value.details,
    };
  }

  if (typeof error === "string" && error) {
    return {
      message: error,
    };
  }

  return {
    message: fallbackMessage,
    details: error,
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (value == null) {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  return value as T;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]);
}

export {
  clampPercent,
  leaseToken,
  nowIso,
  parseJsonValue,
  sleep,
  taskId,
  toErrorShape,
  toRecord,
  withTimeout,
};
