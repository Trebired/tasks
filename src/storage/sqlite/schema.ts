import type { SqliteTaskSchemaOptions } from "#2kjvrax0gr4m";
import { resolveSqliteNames } from "./shared.js";

function createSqliteTaskStoreSchema(options: SqliteTaskSchemaOptions = {}): string {
  const names = resolveSqliteNames(options);

  return [
    createTasksTableSql(names.tasksTable),
    createStepsTableSql(names.stepsTable, names.tasksTable),
    ...createSqliteIndexSql(names),
  ].join("\n\n").trim();
}

function createTasksTableSql(tasksTable: string): string {
  return `
create table if not exists "${tasksTable}" (
  id text primary key,
  kind text not null,
  status text not null,
  input text not null,
  output text,
  error text,
  metadata text not null default '{}',
  progress_percent real,
  progress_label text,
  progress_meta text,
  concurrency_key text,
  dedupe_key text,
  supersede_key text,
  channels text not null default '[]',
  attempt integer not null default 0,
  max_attempts integer not null default 1,
  scheduled_at text not null,
  created_at text not null,
  updated_at text not null,
  claimed_at text,
  started_at text,
  finished_at text,
  cancel_requested_at text,
  lease_owner text,
  lease_token text,
  lease_expires_at text,
  last_heartbeat_at text,
  retry_scheduled_at text,
  stale_at text,
  stale_reason text
);`.trim();
}

function createStepsTableSql(stepsTable: string, tasksTable: string): string {
  return `
create table if not exists "${stepsTable}" (
  id integer primary key autoincrement,
  task_id text not null references "${tasksTable}"(id) on delete cascade,
  attempt integer not null default 0,
  kind text not null,
  level text not null,
  message text not null,
  meta text,
  percent real,
  created_at text not null
);`.trim();
}

function createSqliteIndexSql(names: ReturnType<typeof resolveSqliteNames>): string[] {
  return [
    createIndex(`${names.tasksTable}_status_scheduled_idx`, names.tasksTable, "status, scheduled_at, created_at"),
    createIndex(`${names.tasksTable}_updated_idx`, names.tasksTable, "updated_at desc"),
    createIndex(
      `${names.tasksTable}_lease_idx`,
      names.tasksTable,
      "lease_expires_at",
      "status in ('claimed', 'running')",
    ),
    createIndex(`${names.tasksTable}_kind_status_idx`, names.tasksTable, "kind, status"),
    createIndex(
      `${names.tasksTable}_concurrency_key_idx`,
      names.tasksTable,
      "concurrency_key",
      "concurrency_key is not null",
    ),
    createIndex(
      `${names.tasksTable}_supersede_key_idx`,
      names.tasksTable,
      "kind, supersede_key",
      "supersede_key is not null",
    ),
    createIndex(`${names.stepsTable}_task_id_idx`, names.stepsTable, "task_id, id"),
    createUniqueIndex(
      `${names.tasksTable}_open_dedupe_idx`,
      names.tasksTable,
      "kind, dedupe_key",
      "dedupe_key is not null and status in ('queued', 'claimed', 'running')",
    ),
  ];
}

function createIndex(indexName: string, tableName: string, target: string, where?: string): string {
  return [
    `create index if not exists "${indexName}"`,
    `  on "${tableName}" (${target})`,
    where ? `  where ${where};` : ";",
  ].join("\n");
}

function createUniqueIndex(indexName: string, tableName: string, target: string, where: string): string {
  return [
    `create unique index if not exists "${indexName}"`,
    `  on "${tableName}" (${target})`,
    `  where ${where};`,
  ].join("\n");
}

export {
  createSqliteTaskStoreSchema,
};
