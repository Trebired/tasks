import type { TaskRecord } from "#2kjvrax0gr4m";

function normalizeTaskChannel(value: string): string {
  return value.trim();
}

function uniqueChannels(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (!value) {
      continue;
    }

    const normalized = normalizeTaskChannel(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

const taskChannel = {
  task(taskId: string): string {
    return `task:${taskId}`;
  },
  kind(kind: string): string {
    return `kind:${kind}`;
  },
  dedupe(key: string): string {
    return `dedupe:${key}`;
  },
  concurrency(key: string): string {
    return `concurrency:${key}`;
  },
  supersede(key: string): string {
    return `supersede:${key}`;
  },
  scope(key: string): string {
    return `scope:${key}`;
  },
};

function normalizeTaskChannels(channels?: string[] | null): string[] {
  return uniqueChannels(channels || []);
}

function resolveTaskChannels(task: Pick<TaskRecord, "channels" | "concurrencyKey" | "dedupeKey" | "id" | "kind" | "supersedeKey">): string[] {
  return uniqueChannels([
    taskChannel.task(task.id),
    taskChannel.kind(task.kind),
    task.dedupeKey ? taskChannel.dedupe(task.dedupeKey) : null,
    task.concurrencyKey ? taskChannel.concurrency(task.concurrencyKey) : null,
    task.supersedeKey ? taskChannel.supersede(task.supersedeKey) : null,
    ...(task.channels || []),
  ]);
}

function channelsIntersect(left?: string[] | null, right?: string[] | null): boolean {
  if (!left?.length || !right?.length) {
    return false;
  }

  const set = new Set(left);
  return right.some((value) => set.has(value));
}

export {
  channelsIntersect,
  normalizeTaskChannel,
  normalizeTaskChannels,
  resolveTaskChannels,
  taskChannel,
};
