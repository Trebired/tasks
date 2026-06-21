import type { PostgresTaskSchemaOptions } from "#2kjvrax0gr4m";
import { quoteIdentifier, resolveNames } from "./shared.js";

function createPostgresTaskStoreSchema(options: PostgresTaskSchemaOptions = {}): string {
  const names = resolveNames(options);
  return [
    createSchemaSql(names.schema),
    createTasksTableSql(names),
    createStepsTableSql(names),
    ...createIndexSql(names),
  ].join("\n\n").trim();
}

function createSchemaSql(schema: string): string {
  return `create schema if not exists ${quoteIdentifier(schema)};`;
}

function createTasksTableSql(names: ReturnType<typeof resolveNames>): string {
  return `
create table if not exists ${names.tasksQualified} (
  id text primary key,
  kind text not null,
  status text not null,
  input jsonb not null,
  output jsonb,
  error jsonb,
  metadata jsonb not null default '{}'::jsonb,
  progress_percent double precision,
  progress_label text,
  progress_meta jsonb,
  concurrency_key text,
  dedupe_key text,
  supersede_key text,
  channels jsonb not null default '[]'::jsonb,
  attempt integer not null default 0,
  max_attempts integer not null default 1,
  scheduled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  cancel_requested_at timestamptz,
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  retry_scheduled_at timestamptz,
  stale_at timestamptz,
  stale_reason text
);`.trim();
}

function createStepsTableSql(names: ReturnType<typeof resolveNames>): string {
  return `
create table if not exists ${names.stepsQualified} (
  id bigint generated always as identity primary key,
  task_id text not null references ${names.tasksQualified}(id) on delete cascade,
  attempt integer not null default 0,
  kind text not null,
  level text not null,
  message text not null,
  meta jsonb,
  percent double precision,
  created_at timestamptz not null default now()
);`.trim();
}

function createIndexSql(names: ReturnType<typeof resolveNames>): string[] {
  return [
    createIndex(names, `${names.tasksTable}_status_scheduled_idx`, `${names.tasksQualified} (status, scheduled_at, created_at)`),
    createIndex(names, `${names.tasksTable}_updated_idx`, `${names.tasksQualified} (updated_at desc)`),
    createIndex(names, `${names.tasksTable}_lease_idx`, `${names.tasksQualified} (lease_expires_at)`, "status in ('claimed', 'running')"),
    createIndex(names, `${names.tasksTable}_kind_status_idx`, `${names.tasksQualified} (kind, status)`),
    createIndex(names, `${names.tasksTable}_concurrency_key_idx`, `${names.tasksQualified} (concurrency_key)`, "concurrency_key is not null"),
    createIndex(names, `${names.tasksTable}_supersede_key_idx`, `${names.tasksQualified} (kind, supersede_key)`, "supersede_key is not null"),
    createIndex(names, `${names.stepsTable}_task_id_idx`, `${names.stepsQualified} (task_id, id)`),
    createUniqueIndex(
      names,
      `${names.tasksTable}_open_dedupe_idx`,
      `${names.tasksQualified} (kind, dedupe_key)`,
      "dedupe_key is not null and status in ('queued', 'claimed', 'running')",
    ),
  ];
}

function createIndex(names: ReturnType<typeof resolveNames>, indexName: string, target: string, where?: string): string {
  return [
    `create index if not exists ${quoteIdentifier(indexName)}`,
    `  on ${target}`,
    where ? `  where ${where};` : ";",
  ].join("\n");
}

function createUniqueIndex(names: ReturnType<typeof resolveNames>, indexName: string, target: string, where: string): string {
  return [
    `create unique index if not exists ${quoteIdentifier(indexName)}`,
    `  on ${target}`,
    `  where ${where};`,
  ].join("\n");
}

export {
  createPostgresTaskStoreSchema,
};
