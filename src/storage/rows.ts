import type {
  TaskRecord,
  TaskStatus,
  TaskStepRecord,
  TaskTerminalError,
} from "#2kjvrax0gr4m";
import { nowIso, parseJsonValue } from "#92c6666f713d";
import { normalizeTaskChannels } from "#8942387ee1fc";

type TaskStorageRow = {
  id: string;
  kind: string;
  status: TaskStatus;
  input: unknown;
  output: unknown;
  error: unknown;
  metadata: unknown;
  progress_percent: number | null;
  progress_label: string | null;
  progress_meta: unknown;
  concurrency_key: string | null;
  dedupe_key: string | null;
  supersede_key: string | null;
  channels: unknown;
  attempt: number;
  max_attempts: number;
  scheduled_at: string;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  cancel_requested_at: string | null;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  last_heartbeat_at: string | null;
  retry_scheduled_at: string | null;
  stale_at: string | null;
  stale_reason: string | null;
};

type TaskStepStorageRow = {
  id: number | string;
  task_id: string;
  attempt: number;
  kind: string;
  level: string;
  message: string;
  meta: unknown;
  percent: number | null;
  created_at: string;
};

function mapStorageTaskRow(row: TaskStorageRow): TaskRecord {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    input: parseJsonValue(row.input, null),
    output: parseJsonValue(row.output, null),
    error: parseJsonValue<TaskTerminalError|null>(row.error, null),
    metadata: parseJsonValue(row.metadata, {}),
    progressPercent: typeof row.progress_percent === "number" ? row.progress_percent : null,
    progressLabel: row.progress_label,
    progressMeta: parseJsonValue(row.progress_meta, null),
    concurrencyKey: row.concurrency_key,
    dedupeKey: row.dedupe_key,
    supersedeKey: row.supersede_key,
    channels: normalizeTaskChannels(parseJsonValue(row.channels, [])),
    attempt: Number(row.attempt || 0),
    maxAttempts: Number(row.max_attempts || 1),
    scheduledAt: nowIso(row.scheduled_at),
    createdAt: nowIso(row.created_at),
    updatedAt: nowIso(row.updated_at),
    claimedAt: row.claimed_at ? nowIso(row.claimed_at) : null,
    startedAt: row.started_at ? nowIso(row.started_at) : null,
    finishedAt: row.finished_at ? nowIso(row.finished_at) : null,
    cancelRequestedAt: row.cancel_requested_at ? nowIso(row.cancel_requested_at) : null,
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at ? nowIso(row.lease_expires_at) : null,
    lastHeartbeatAt: row.last_heartbeat_at ? nowIso(row.last_heartbeat_at) : null,
    retryScheduledAt: row.retry_scheduled_at ? nowIso(row.retry_scheduled_at) : null,
    staleAt: row.stale_at ? nowIso(row.stale_at) : null,
    staleReason: row.stale_reason,
  };
}

function mapStorageStepRow(row: TaskStepStorageRow): TaskStepRecord {
  return {
    id: String(row.id),
    taskId: row.task_id,
    attempt: Number(row.attempt || 0),
    kind: row.kind,
    level: row.level,
    message: row.message,
    meta: parseJsonValue(row.meta, null),
    percent: typeof row.percent === "number" ? row.percent : null,
    createdAt: nowIso(row.created_at),
  };
}

export {
  mapStorageStepRow,
  mapStorageTaskRow,
};
export type {
  TaskStepStorageRow,
  TaskStorageRow,
};
