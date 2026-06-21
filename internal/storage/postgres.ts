import type {
  PostgresTaskPoolClient,
  PostgresTaskSchemaOptions,
  PostgresTaskStoreOptions,
  TaskAggregateSnapshot,
  TaskAppendStepInput,
  TaskCancelInput,
  TaskCancelRunningInput,
  TaskClaimNextOptions,
  TaskCreateInput,
  TaskCreateResult,
  TaskDedupeLookup,
  TaskFailureInput,
  TaskLeaseInput,
  TaskLeaseRenewalInput,
  TaskListQuery,
  TaskMarkStaleInput,
  TaskRecord,
  TaskRetentionPolicy,
  TaskRetentionResult,
  TaskRetryInput,
  TaskStatus,
  TaskStepListQuery,
  TaskStepRecord,
  TaskStore,
  TaskSuccessInput,
  TaskTerminalError,
  TaskUpdateProgressInput,
} from "#2kjvrax0gr4m";
import { buildTaskAggregateSnapshot, createTaskSnapshot } from "#ir9grtwyf3f1";
import { clampPercent, nowIso, parseJsonValue, toErrorShape } from "#qysd2ddsh0x8";
import { normalizeTaskChannels } from "#xx6ozac2scdj";

type TaskRow = {
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

type TaskStepRow = {
  id: string;
  task_id: string;
  attempt: number;
  kind: string;
  level: string;
  message: string;
  meta: unknown;
  percent: number | null;
  created_at: string;
};

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function resolveNames(options: PostgresTaskSchemaOptions = {}): {
  schema: string;
  tasksTable: string;
  stepsTable: string;
  tasksQualified: string;
  stepsQualified: string;
} {
  const schema = options.schema || "public";
  const tablePrefix = options.tablePrefix || "tb_";
  const tasksTable = `${tablePrefix}tasks`;
  const stepsTable = `${tablePrefix}task_steps`;

  return {
    schema,
    tasksTable,
    stepsTable,
    tasksQualified: `${quoteIdentifier(schema)}.${quoteIdentifier(tasksTable)}`,
    stepsQualified: `${quoteIdentifier(schema)}.${quoteIdentifier(stepsTable)}`,
  };
}

function createPostgresTaskStoreSchema(options: PostgresTaskSchemaOptions = {}): string {
  const names = resolveNames(options);
  return `
create schema if not exists ${quoteIdentifier(names.schema)};

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
);

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
);

create index if not exists ${quoteIdentifier(`${names.tasksTable}_status_scheduled_idx`)}
  on ${names.tasksQualified} (status, scheduled_at, created_at);

create index if not exists ${quoteIdentifier(`${names.tasksTable}_updated_idx`)}
  on ${names.tasksQualified} (updated_at desc);

create index if not exists ${quoteIdentifier(`${names.tasksTable}_lease_idx`)}
  on ${names.tasksQualified} (lease_expires_at)
  where status in ('claimed', 'running');

create index if not exists ${quoteIdentifier(`${names.tasksTable}_kind_status_idx`)}
  on ${names.tasksQualified} (kind, status);

create index if not exists ${quoteIdentifier(`${names.tasksTable}_concurrency_key_idx`)}
  on ${names.tasksQualified} (concurrency_key)
  where concurrency_key is not null;

create index if not exists ${quoteIdentifier(`${names.tasksTable}_supersede_key_idx`)}
  on ${names.tasksQualified} (kind, supersede_key)
  where supersede_key is not null;

create index if not exists ${quoteIdentifier(`${names.stepsTable}_task_id_idx`)}
  on ${names.stepsQualified} (task_id, id);

create unique index if not exists ${quoteIdentifier(`${names.tasksTable}_open_dedupe_idx`)}
  on ${names.tasksQualified} (kind, dedupe_key)
  where dedupe_key is not null and status in ('queued', 'claimed', 'running');
`.trim();
}

async function withTransaction<T>(client: PostgresTaskStoreOptions["client"], run: (tx: PostgresTaskPoolClient) => Promise<T>): Promise<T> {
  const tx = await client.connect();
  try {
    await tx.query("begin");
    const result = await run(tx);
    await tx.query("commit");
    return result;
  } catch (error) {
    await tx.query("rollback");
    throw error;
  } finally {
    tx.release();
  }
}

function mapTaskRow(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    input: parseJsonValue(row.input, null),
    output: parseJsonValue(row.output, null),
    error: parseJsonValue<TaskTerminalError | null>(row.error, null),
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

function mapStepRow(row: TaskStepRow): TaskStepRecord {
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

function buildWhereClause(query: TaskListQuery = {}): {
  params: unknown[];
  sql: string;
} {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.taskIds?.length) {
    params.push(query.taskIds);
    where.push(`id = any($${params.length}::text[])`);
  }

  if (query.kinds?.length) {
    params.push(query.kinds);
    where.push(`kind = any($${params.length}::text[])`);
  }

  if (query.statuses?.length) {
    params.push(query.statuses);
    where.push(`status = any($${params.length}::text[])`);
  }

  if (query.channels?.length) {
    params.push(query.channels);
    where.push(`exists (
      select 1
      from jsonb_array_elements_text(channels) as channel(value)
      where channel.value = any($${params.length}::text[])
    )`);
  }

  if (query.concurrencyKey) {
    params.push(query.concurrencyKey);
    where.push(`concurrency_key = $${params.length}`);
  }

  if (query.dedupeKey) {
    params.push(query.dedupeKey);
    where.push(`dedupe_key = $${params.length}`);
  }

  if (query.supersedeKey) {
    params.push(query.supersedeKey);
    where.push(`supersede_key = $${params.length}`);
  }

  return {
    params,
    sql: where.length ? `where ${where.join(" and ")}` : "",
  };
}

function normalizeOrder(orderBy?: TaskListQuery["orderBy"]): string {
  switch (orderBy) {
    case "created_asc":
      return "created_at asc";
    case "scheduled_asc":
      return "scheduled_at asc, created_at asc";
    case "scheduled_desc":
      return "scheduled_at desc, created_at desc";
    case "updated_desc":
      return "updated_at desc";
    case "created_desc":
    default:
      return "created_at desc";
  }
}

function createPostgresTaskStore(options: PostgresTaskStoreOptions): TaskStore {
  const names = resolveNames(options);

  return {
    async createTask(input: TaskCreateInput): Promise<TaskCreateResult> {
      return withTransaction(options.client, async (tx) => {
        if (input.dedupeKey) {
          const existing = await tx.query<TaskRow>(`
            select *
            from ${names.tasksQualified}
            where kind = $1
              and dedupe_key = $2
              and status in ('queued', 'claimed', 'running')
            order by created_at desc
            limit 1
            for update
          `, [input.kind, input.dedupeKey]);

          if (existing.rows[0]) {
            return {
              task: mapTaskRow(existing.rows[0]),
              deduplicated: true,
              disposition: "reused",
              reusedTaskId: existing.rows[0].id,
              supersededTaskIds: [],
            };
          }
        }

        let supersededTaskIds: string[] = [];

        if (input.supersedeExisting && input.supersedeKey) {
          const superseded = await tx.query<{ id: string }>(`
            update ${names.tasksQualified}
            set
              status = 'cancelled',
              error = $3::jsonb,
              cancel_requested_at = $4::timestamptz,
              finished_at = $4::timestamptz,
              updated_at = $4::timestamptz,
              lease_owner = null,
              lease_token = null,
              lease_expires_at = null
            where kind = $1
              and supersede_key = $2
              and status in ('queued', 'claimed', 'running')
            returning id
          `, [
            input.kind,
            input.supersedeKey,
            JSON.stringify(toErrorShape({
              message: "Task superseded by a newer task",
              code: "TASK_SUPERSEDED",
            })),
            nowIso(),
          ]);
          supersededTaskIds = superseded.rows.map((row) => row.id);
        }

        const createdAt = nowIso();
        const inserted = await tx.query<TaskRow>(`
          insert into ${names.tasksQualified} (
            id,
            kind,
            status,
            input,
            metadata,
            concurrency_key,
            dedupe_key,
            supersede_key,
            channels,
            attempt,
            max_attempts,
            scheduled_at,
            created_at,
            updated_at
          )
          values ($1, $2, 'queued', $3::jsonb, $4::jsonb, $5, $6, $7, $8::jsonb, 0, $9, $10::timestamptz, $11::timestamptz, $11::timestamptz)
          returning *
        `, [
          input.id,
          input.kind,
          JSON.stringify(input.input ?? null),
          JSON.stringify(input.metadata ?? {}),
          input.concurrencyKey ?? null,
          input.dedupeKey ?? null,
          input.supersedeKey ?? null,
          JSON.stringify(normalizeTaskChannels(input.channels)),
          input.maxAttempts,
          nowIso(input.scheduledAt),
          createdAt,
        ]);

        if (!inserted.rows[0]) {
          throw new Error(`Unable to create task ${input.id}`);
        }

        return {
          task: mapTaskRow(inserted.rows[0]),
          deduplicated: false,
          disposition: supersededTaskIds.length ? "superseded" : "created",
          reusedTaskId: null,
          supersededTaskIds,
        };
      });
    },

    async getTask<TInput = unknown, TResult = unknown>(taskId: string): Promise<TaskRecord<TInput, TResult> | null> {
      const result = await options.client.query<TaskRow>(`select * from ${names.tasksQualified} where id = $1 limit 1`, [taskId]);
      return (result.rows[0] ? mapTaskRow(result.rows[0]) : null) as TaskRecord<TInput, TResult> | null;
    },

    async listTasks<TInput = unknown, TResult = unknown>(query: TaskListQuery = {}): Promise<TaskRecord<TInput, TResult>[]> {
      const where = buildWhereClause(query);
      const params = [...where.params];
      params.push(Math.max(1, query.limit ?? 100));
      const limitParam = params.length;
      params.push(Math.max(0, query.offset ?? 0));
      const offsetParam = params.length;

      const result = await options.client.query<TaskRow>(`
        select *
        from ${names.tasksQualified}
        ${where.sql}
        order by ${normalizeOrder(query.orderBy)}
        limit $${limitParam}
        offset $${offsetParam}
      `, params);

      return result.rows.map(mapTaskRow) as TaskRecord<TInput, TResult>[];
    },

    async summarizeTasks(query: TaskListQuery = {}): Promise<TaskAggregateSnapshot> {
      const where = buildWhereClause(query);
      const rows = await options.client.query<TaskRow>(`
        select *
        from ${names.tasksQualified}
        ${where.sql}
      `, where.params);

      return buildTaskAggregateSnapshot(rows.rows.map((row) => createTaskSnapshot(mapTaskRow(row))));
    },

    async listTaskSteps(taskId: string, query: TaskStepListQuery = {}): Promise<TaskStepRecord[]> {
      const result = await options.client.query<TaskStepRow>(`
        select
          id::text as id,
          task_id,
          attempt,
          kind,
          level,
          message,
          meta,
          percent,
          created_at
        from ${names.stepsQualified}
        where task_id = $1
        order by id asc
        limit $2
        offset $3
      `, [
        taskId,
        Math.max(1, query.limit ?? 200),
        Math.max(0, query.offset ?? 0),
      ]);
      return result.rows.map(mapStepRow);
    },

    async findTaskByDedupeKey<TInput = unknown, TResult = unknown>(input: TaskDedupeLookup): Promise<TaskRecord<TInput, TResult> | null> {
      const statuses = input.openOnly === false ? null : ["queued", "claimed", "running"];
      const result = await options.client.query<TaskRow>(`
        select *
        from ${names.tasksQualified}
        where kind = $1
          and dedupe_key = $2
          ${statuses ? "and status = any($3::text[])" : ""}
        order by created_at desc
        limit 1
      `, statuses ? [input.kind, input.dedupeKey, statuses] : [input.kind, input.dedupeKey]);
      return (result.rows[0] ? mapTaskRow(result.rows[0]) : null) as TaskRecord<TInput, TResult> | null;
    },

    async claimNextTask<TInput = unknown, TResult = unknown>(input: TaskClaimNextOptions): Promise<TaskRecord<TInput, TResult> | null> {
      if (!input.kinds.length) {
        return null;
      }

      return withTransaction(options.client, async (tx) => {
        await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`${names.schema}.${names.tasksTable}.claim`]);

        if (input.globalConcurrency && input.globalConcurrency > 0) {
          const count = await tx.query<{ count: string }>(`
            select count(*)::text as count
            from ${names.tasksQualified}
            where status in ('claimed', 'running')
          `);
          if (Number(count.rows[0]?.count || "0") >= input.globalConcurrency) {
            return null;
          }
        }

        const busyKeys = await tx.query<{ concurrency_key: string }>(`
          select distinct concurrency_key
          from ${names.tasksQualified}
          where status in ('claimed', 'running')
            and concurrency_key is not null
        `);
        const busyKeySet = new Set(busyKeys.rows.map((row) => row.concurrency_key));

        const kindCountCache = new Map<string, number>();
        const queued = await tx.query<TaskRow>(`
          select *
          from ${names.tasksQualified}
          where status = 'queued'
            and kind = any($1::text[])
            and scheduled_at <= $2::timestamptz
          order by scheduled_at asc, created_at asc
          limit $3
          for update skip locked
        `, [
          input.kinds,
          nowIso(input.now),
          Math.max(1, input.candidateLimit ?? 100),
        ]);

        for (const row of queued.rows) {
          const kindLimit = input.perKindConcurrency?.[row.kind];
          if (kindLimit && kindLimit > 0) {
            let count = kindCountCache.get(row.kind);
            if (count == null) {
              const result = await tx.query<{ count: string }>(`
                select count(*)::text as count
                from ${names.tasksQualified}
                where status in ('claimed', 'running')
                  and kind = $1
              `, [row.kind]);
              count = Number(result.rows[0]?.count || "0");
              kindCountCache.set(row.kind, count);
            }

            if (count >= kindLimit) {
              continue;
            }
          }

          if (row.concurrency_key && busyKeySet.has(row.concurrency_key)) {
            continue;
          }

          const token = taskToken();
          const current = nowIso(input.now);
          const updated = await tx.query<TaskRow>(`
            update ${names.tasksQualified}
            set
              status = 'claimed',
              attempt = attempt + 1,
              claimed_at = $2::timestamptz,
              updated_at = $2::timestamptz,
              lease_owner = $3,
              lease_token = $4,
              lease_expires_at = $5::timestamptz,
              last_heartbeat_at = $2::timestamptz,
              stale_at = null,
              stale_reason = null
            where id = $1
              and status = 'queued'
            returning *
          `, [
            row.id,
            current,
            input.runnerId,
            token,
            nowIso(Date.parse(current) + input.leaseMs),
          ]);

          if (updated.rows[0]) {
            return mapTaskRow(updated.rows[0]) as TaskRecord<TInput, TResult>;
          }
        }

        return null;
      });
    },

    async markTaskRunning<TInput = unknown, TResult = unknown>(input: TaskLeaseInput): Promise<TaskRecord<TInput, TResult> | null> {
      const result = await options.client.query<TaskRow>(`
        update ${names.tasksQualified}
        set
          status = 'running',
          started_at = coalesce(started_at, now()),
          updated_at = now(),
          stale_at = null,
          stale_reason = null
        where id = $1
          and lease_owner = $2
          and lease_token = $3
          and status in ('claimed', 'running')
        returning *
      `, [input.taskId, input.runnerId, input.leaseToken]);
      return (result.rows[0] ? mapTaskRow(result.rows[0]) : null) as TaskRecord<TInput, TResult> | null;
    },

    async renewTaskLease<TInput = unknown, TResult = unknown>(input: TaskLeaseRenewalInput): Promise<TaskRecord<TInput, TResult> | null> {
      const current = nowIso(input.now);
      const result = await options.client.query<TaskRow>(`
        update ${names.tasksQualified}
        set
          lease_expires_at = $4::timestamptz,
          last_heartbeat_at = $5::timestamptz,
          updated_at = $5::timestamptz,
          stale_at = null,
          stale_reason = null
        where id = $1
          and lease_owner = $2
          and lease_token = $3
          and status in ('claimed', 'running')
        returning *
      `, [
        input.taskId,
        input.runnerId,
        input.leaseToken,
        nowIso(Date.parse(current) + input.leaseMs),
        current,
      ]);
      return (result.rows[0] ? mapTaskRow(result.rows[0]) : null) as TaskRecord<TInput, TResult> | null;
    },

    async appendTaskStep(input: TaskAppendStepInput): Promise<TaskStepRecord | null> {
      const result = await options.client.query<TaskStepRow>(`
        insert into ${names.stepsQualified} (
          task_id,
          attempt,
          kind,
          level,
          message,
          meta,
          percent,
          created_at
        )
        select
          id,
          $4,
          $5,
          $6,
          $7,
          $8::jsonb,
          $9,
          $10::timestamptz
        from ${names.tasksQualified}
        where id = $1
          and lease_owner = $2
          and lease_token = $3
        returning
          id::text as id,
          task_id,
          attempt,
          kind,
          level,
          message,
          meta,
          percent,
          created_at
      `, [
        input.taskId,
        input.runnerId,
        input.leaseToken,
        input.attempt,
        input.kind ?? "step",
        input.level ?? "info",
        input.message || input.label || "step",
        JSON.stringify(input.meta ?? null),
        clampPercent(input.percent ?? input.progressPercent),
        nowIso(input.createdAt),
      ]);
      return result.rows[0] ? mapStepRow(result.rows[0]) : null;
    },

    async updateTaskProgress<TInput = unknown, TResult = unknown>(input: TaskUpdateProgressInput): Promise<TaskRecord<TInput, TResult> | null> {
      const result = await options.client.query<TaskRow>(`
        update ${names.tasksQualified}
        set
          progress_percent = coalesce($4, progress_percent),
          progress_label = case when $5::text is null then progress_label else $5::text end,
          progress_meta = case when $6::jsonb is null then progress_meta else $6::jsonb end,
          updated_at = $7::timestamptz,
          stale_at = null,
          stale_reason = null
        where id = $1
          and lease_owner = $2
          and lease_token = $3
          and status in ('claimed', 'running')
        returning *
      `, [
        input.taskId,
        input.runnerId,
        input.leaseToken,
        clampPercent(input.percent),
        input.label ?? null,
        input.meta == null ? null : JSON.stringify(input.meta),
        nowIso(input.updatedAt),
      ]);
      return (result.rows[0] ? mapTaskRow(result.rows[0]) : null) as TaskRecord<TInput, TResult> | null;
    },

    async markTaskSucceeded<TInput = unknown, TResult = unknown>(input: TaskSuccessInput<TResult>): Promise<TaskRecord<TInput, TResult> | null> {
      const result = await options.client.query<TaskRow>(`
        update ${names.tasksQualified}
        set
          status = 'succeeded',
          output = $4::jsonb,
          error = null,
          progress_percent = 100,
          finished_at = $5::timestamptz,
          updated_at = $5::timestamptz,
          lease_owner = null,
          lease_token = null,
          lease_expires_at = null,
          retry_scheduled_at = null,
          stale_at = null,
          stale_reason = null
        where id = $1
          and lease_owner = $2
          and lease_token = $3
          and status in ('claimed', 'running')
        returning *
      `, [
        input.taskId,
        input.runnerId,
        input.leaseToken,
        JSON.stringify(input.output ?? null),
        nowIso(input.finishedAt),
      ]);
      return (result.rows[0] ? mapTaskRow(result.rows[0]) : null) as TaskRecord<TInput, TResult> | null;
    },

    async markTaskFailed<TInput = unknown, TResult = unknown>(input: TaskFailureInput): Promise<TaskRecord<TInput, TResult> | null> {
      const error = input.error || toErrorShape("Task failed");
      const result = await options.client.query<TaskRow>(`
        update ${names.tasksQualified}
        set
          status = 'failed',
          error = $4::jsonb,
          finished_at = $5::timestamptz,
          updated_at = $5::timestamptz,
          lease_owner = null,
          lease_token = null,
          lease_expires_at = null,
          retry_scheduled_at = null
        where id = $1
          and lease_owner = $2
          and lease_token = $3
          and status in ('claimed', 'running')
        returning *
      `, [
        input.taskId,
        input.runnerId,
        input.leaseToken,
        JSON.stringify(error),
        nowIso(input.finishedAt),
      ]);
      return (result.rows[0] ? mapTaskRow(result.rows[0]) : null) as TaskRecord<TInput, TResult> | null;
    },

    async cancelTask<TInput = unknown, TResult = unknown>(input: TaskCancelInput): Promise<TaskRecord<TInput, TResult> | null> {
      const current = nowIso(input.requestedAt);
      const reason = input.reason
        ? toErrorShape({ message: input.reason, code: "TASK_CANCELLED" })
        : toErrorShape({ message: "Task cancelled", code: "TASK_CANCELLED" });

      const existing = await this.getTask(input.taskId);
      if (!existing) {
        return null;
      }

      if (existing.status === "queued") {
        const result = await options.client.query<TaskRow>(`
          update ${names.tasksQualified}
          set
            status = 'cancelled',
            error = $2::jsonb,
            cancel_requested_at = $3::timestamptz,
            finished_at = $3::timestamptz,
            updated_at = $3::timestamptz,
            retry_scheduled_at = null
          where id = $1
            and status = 'queued'
          returning *
        `, [input.taskId, JSON.stringify(reason), current]);
        return (result.rows[0] ? mapTaskRow(result.rows[0]) : existing) as TaskRecord<TInput, TResult>;
      }

      if (existing.status === "claimed" || existing.status === "running") {
        const result = await options.client.query<TaskRow>(`
          update ${names.tasksQualified}
          set
            cancel_requested_at = coalesce(cancel_requested_at, $2::timestamptz),
            error = coalesce(error, $3::jsonb),
            updated_at = $2::timestamptz
          where id = $1
            and status in ('claimed', 'running')
          returning *
        `, [input.taskId, current, JSON.stringify(reason)]);
        return (result.rows[0] ? mapTaskRow(result.rows[0]) : existing) as TaskRecord<TInput, TResult>;
      }

      return existing as TaskRecord<TInput, TResult>;
    },

    async markTaskCancelled<TInput = unknown, TResult = unknown>(input: TaskCancelRunningInput): Promise<TaskRecord<TInput, TResult> | null> {
      const reason = input.reason
        ? toErrorShape({ message: input.reason, code: "TASK_CANCELLED" })
        : toErrorShape({ message: "Task cancelled", code: "TASK_CANCELLED" });
      const result = await options.client.query<TaskRow>(`
        update ${names.tasksQualified}
        set
          status = 'cancelled',
          error = $4::jsonb,
          finished_at = $5::timestamptz,
          updated_at = $5::timestamptz,
          lease_owner = null,
          lease_token = null,
          lease_expires_at = null,
          retry_scheduled_at = null
        where id = $1
          and lease_owner = $2
          and lease_token = $3
          and status in ('claimed', 'running')
        returning *
      `, [
        input.taskId,
        input.runnerId,
        input.leaseToken,
        JSON.stringify(reason),
        nowIso(input.finishedAt),
      ]);
      return (result.rows[0] ? mapTaskRow(result.rows[0]) : null) as TaskRecord<TInput, TResult> | null;
    },

    async requeueTask<TInput = unknown, TResult = unknown>(input: TaskRetryInput): Promise<TaskRecord<TInput, TResult> | null> {
      const result = await options.client.query<TaskRow>(`
        update ${names.tasksQualified}
        set
          status = 'queued',
          error = $4::jsonb,
          progress_percent = null,
          progress_label = null,
          progress_meta = null,
          scheduled_at = $5::timestamptz,
          retry_scheduled_at = $5::timestamptz,
          updated_at = now(),
          lease_owner = null,
          lease_token = null,
          lease_expires_at = null,
          stale_at = null,
          stale_reason = null
        where id = $1
          and lease_owner = $2
          and lease_token = $3
          and status in ('claimed', 'running')
        returning *
      `, [
        input.taskId,
        input.runnerId,
        input.leaseToken,
        JSON.stringify(input.error),
        nowIso(input.scheduledAt),
      ]);
      return (result.rows[0] ? mapTaskRow(result.rows[0]) : null) as TaskRecord<TInput, TResult> | null;
    },

    async markStaleTasks<TInput = unknown, TResult = unknown>(input: TaskMarkStaleInput): Promise<TaskRecord<TInput, TResult>[]> {
      const current = nowIso(input.now);
      const threshold = nowIso(Date.parse(current) - input.staleAfterMs);
      const result = await options.client.query<TaskRow>(`
        update ${names.tasksQualified}
        set
          stale_at = coalesce(stale_at, $2::timestamptz),
          stale_reason = coalesce(stale_reason, $3),
          updated_at = $2::timestamptz
        where id in (
          select id
          from ${names.tasksQualified}
          where status in ('claimed', 'running')
            and coalesce(last_heartbeat_at, updated_at) < $1::timestamptz
            and stale_at is null
          order by updated_at asc
          limit $4
        )
        returning *
      `, [
        threshold,
        current,
        input.reason || "Task became stale",
        Math.max(1, input.limit ?? 100),
      ]);
      return result.rows.map(mapTaskRow) as TaskRecord<TInput, TResult>[];
    },

    async requeueStaleTasks(input = {}): Promise<number> {
      const current = nowIso(input.now);
      const stale = await options.client.query<TaskRow>(`
        select *
        from ${names.tasksQualified}
        where status in ('claimed', 'running')
          and lease_expires_at is not null
          and lease_expires_at < $1::timestamptz
        order by lease_expires_at asc
        limit $2
      `, [
        current,
        Math.max(1, input.limit ?? 100),
      ]);

      let affected = 0;
      for (const row of stale.rows) {
        const error = toErrorShape({
          message: "Task lease expired and was recovered",
          code: "TASK_LEASE_EXPIRED",
        });

        if (Number(row.attempt || 0) >= Number(row.max_attempts || 1)) {
          const result = await options.client.query(`
            update ${names.tasksQualified}
            set
              status = 'failed',
              error = $2::jsonb,
              finished_at = $3::timestamptz,
              updated_at = $3::timestamptz,
              lease_owner = null,
              lease_token = null,
              lease_expires_at = null,
              stale_at = $3::timestamptz,
              stale_reason = 'Task lease expired and max attempts were exhausted'
            where id = $1
              and status in ('claimed', 'running')
          `, [
            row.id,
            JSON.stringify(error),
            current,
          ]);
          affected += Number(result.rowCount || 0);
          continue;
        }

        const result = await options.client.query(`
          update ${names.tasksQualified}
          set
            status = 'queued',
            error = $2::jsonb,
            progress_percent = null,
            progress_label = null,
            progress_meta = null,
            scheduled_at = $3::timestamptz,
            retry_scheduled_at = null,
            updated_at = $3::timestamptz,
            lease_owner = null,
            lease_token = null,
            lease_expires_at = null,
            stale_at = $3::timestamptz,
            stale_reason = 'Task lease expired and was requeued'
          where id = $1
            and status in ('claimed', 'running')
        `, [
          row.id,
          JSON.stringify(error),
          current,
        ]);
        affected += Number(result.rowCount || 0);
      }

      return affected;
    },

    async applyRetentionPolicy(policy: TaskRetentionPolicy): Promise<TaskRetentionResult> {
      let deletedTasks = 0;
      let deletedSteps = 0;
      let compactedTasks = 0;

      if (policy.stepLimitPerTask && policy.stepLimitPerTask > 0) {
        const deleted = await options.client.query<{ id: string; task_id: string }>(`
          with ranked as (
            select
              id,
              task_id,
              row_number() over (partition by task_id order by id desc) as rn
            from ${names.stepsQualified}
          )
          delete from ${names.stepsQualified}
          where id in (
            select id
            from ranked
            where rn > $1
          )
          returning id::text, task_id
        `, [policy.stepLimitPerTask]);
        deletedSteps += Number(deleted.rowCount || 0);
        compactedTasks += new Set(deleted.rows.map((row) => row.task_id)).size;
      }

      for (const [status, ttlMs] of [
        ["succeeded", policy.successTtlMs],
        ["failed", policy.failedTtlMs],
        ["cancelled", policy.cancelledTtlMs],
      ] as const) {
        if (!ttlMs || ttlMs <= 0) {
          continue;
        }

        const cutoff = nowIso(Date.now() - ttlMs);
        const deleted = await options.client.query(`
          delete from ${names.tasksQualified}
          where status = $1
            and finished_at is not null
            and finished_at < $2::timestamptz
        `, [status, cutoff]);
        deletedTasks += Number(deleted.rowCount || 0);
      }

      if (policy.keepLatestSuccessesPerKind && policy.keepLatestSuccessesPerKind > 0) {
        const deleted = await options.client.query(`
          with ranked as (
            select
              id,
              row_number() over (partition by kind order by finished_at desc nulls last, created_at desc) as rn
            from ${names.tasksQualified}
            where status = 'succeeded'
          )
          delete from ${names.tasksQualified}
          where id in (
            select id
            from ranked
            where rn > $1
          )
        `, [policy.keepLatestSuccessesPerKind]);
        deletedTasks += Number(deleted.rowCount || 0);
      }

      if (policy.keepLatestFailuresPerKind && policy.keepLatestFailuresPerKind > 0) {
        const deleted = await options.client.query(`
          with ranked as (
            select
              id,
              row_number() over (partition by kind order by finished_at desc nulls last, created_at desc) as rn
            from ${names.tasksQualified}
            where status = 'failed'
          )
          delete from ${names.tasksQualified}
          where id in (
            select id
            from ranked
            where rn > $1
          )
        `, [policy.keepLatestFailuresPerKind]);
        deletedTasks += Number(deleted.rowCount || 0);
      }

      return {
        deletedTasks,
        deletedSteps,
        compactedTasks,
      };
    },
  };
}

function taskToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export {
  createPostgresTaskStore,
  createPostgresTaskStoreSchema,
};
