import type {
  PostgresTaskPoolClient,
  PostgresTaskSchemaOptions,
  PostgresTaskStoreOptions,
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
  TaskRecord,
  TaskRetryInput,
  TaskStatus,
  TaskStepListQuery,
  TaskStepRecord,
  TaskStore,
  TaskSuccessInput,
  TaskTerminalError,
  TaskUpdateProgressInput,
} from "../types.js";
import { clampPercent, nowIso, parseJsonValue, toErrorShape, toRecord } from "../core/utils.js";

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
};

type TaskStepRow = {
  sequence: string;
  task_id: string;
  attempt: number;
  kind: "step" | "event";
  label: string;
  meta: unknown;
  progress_percent: number | null;
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
  last_heartbeat_at timestamptz
);

create table if not exists ${names.stepsQualified} (
  sequence bigint generated always as identity primary key,
  task_id text not null references ${names.tasksQualified}(id) on delete cascade,
  attempt integer not null default 0,
  kind text not null,
  label text not null,
  meta jsonb,
  progress_percent double precision,
  created_at timestamptz not null default now()
);

create index if not exists ${quoteIdentifier(`${names.tasksTable}_status_scheduled_idx`)}
  on ${names.tasksQualified} (status, scheduled_at, created_at);

create index if not exists ${quoteIdentifier(`${names.tasksTable}_lease_idx`)}
  on ${names.tasksQualified} (lease_expires_at)
  where status in ('claimed', 'running');

create index if not exists ${quoteIdentifier(`${names.tasksTable}_kind_status_idx`)}
  on ${names.tasksQualified} (kind, status);

create index if not exists ${quoteIdentifier(`${names.tasksTable}_concurrency_key_idx`)}
  on ${names.tasksQualified} (concurrency_key)
  where concurrency_key is not null;

create index if not exists ${quoteIdentifier(`${names.stepsTable}_task_sequence_idx`)}
  on ${names.stepsQualified} (task_id, sequence);

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
  };
}

function mapStepRow(row: TaskStepRow): TaskStepRecord {
  return {
    sequence: String(row.sequence),
    taskId: row.task_id,
    attempt: Number(row.attempt || 0),
    kind: row.kind,
    label: row.label,
    meta: parseJsonValue(row.meta, null),
    progressPercent: typeof row.progress_percent === "number" ? row.progress_percent : null,
    createdAt: nowIso(row.created_at),
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
    case "created_desc":
    default:
      return "created_at desc";
  }
}

function createPostgresTaskStore(options: PostgresTaskStoreOptions): TaskStore {
  const names = resolveNames(options);

  return {
    async createTask(input: TaskCreateInput): Promise<TaskCreateResult> {
      const sql = `
        insert into ${names.tasksQualified} (
          id,
          kind,
          status,
          input,
          metadata,
          concurrency_key,
          dedupe_key,
          attempt,
          max_attempts,
          scheduled_at,
          created_at,
          updated_at
        )
        values ($1, $2, 'queued', $3::jsonb, $4::jsonb, $5, $6, 0, $7, $8::timestamptz, $9::timestamptz, $9::timestamptz)
        on conflict do nothing
        returning *
      `;
      const createdAt = nowIso();
      const inserted = await options.client.query<TaskRow>(sql, [
        input.id,
        input.kind,
        JSON.stringify(input.input ?? null),
        JSON.stringify(input.metadata ?? {}),
        input.concurrencyKey ?? null,
        input.dedupeKey ?? null,
        input.maxAttempts,
        nowIso(input.scheduledAt),
        createdAt,
      ]);

      if (inserted.rows[0]) {
        return {
          task: mapTaskRow(inserted.rows[0]),
          deduplicated: false,
        };
      }

      if (input.dedupeKey) {
        const existing = await this.findTaskByDedupeKey({
          kind: input.kind,
          dedupeKey: input.dedupeKey,
          openOnly: true,
        });

        if (existing) {
          return {
            task: existing,
            deduplicated: true,
          };
        }
      }

      throw new Error(`Unable to create task ${input.id}`);
    },

    async getTask<TInput = unknown, TResult = unknown>(taskId: string): Promise<TaskRecord<TInput, TResult> | null> {
      const result = await options.client.query<TaskRow>(`select * from ${names.tasksQualified} where id = $1 limit 1`, [taskId]);
      return (result.rows[0] ? mapTaskRow(result.rows[0]) : null) as TaskRecord<TInput, TResult> | null;
    },

    async listTasks<TInput = unknown, TResult = unknown>(query: TaskListQuery = {}): Promise<TaskRecord<TInput, TResult>[]> {
      const where: string[] = [];
      const params: unknown[] = [];

      if (query.kinds?.length) {
        params.push(query.kinds);
        where.push(`kind = any($${params.length}::text[])`);
      }

      if (query.statuses?.length) {
        params.push(query.statuses);
        where.push(`status = any($${params.length}::text[])`);
      }

      if (query.concurrencyKey) {
        params.push(query.concurrencyKey);
        where.push(`concurrency_key = $${params.length}`);
      }

      if (query.dedupeKey) {
        params.push(query.dedupeKey);
        where.push(`dedupe_key = $${params.length}`);
      }

      params.push(Math.max(1, query.limit ?? 50));
      const limitParam = params.length;
      params.push(Math.max(0, query.offset ?? 0));
      const offsetParam = params.length;

      const sql = `
        select *
        from ${names.tasksQualified}
        ${where.length ? `where ${where.join(" and ")}` : ""}
        order by ${normalizeOrder(query.orderBy)}
        limit $${limitParam}
        offset $${offsetParam}
      `;
      const result = await options.client.query<TaskRow>(sql, params);
      return result.rows.map(mapTaskRow) as TaskRecord<TInput, TResult>[];
    },

    async listTaskSteps(taskId: string, query: TaskStepListQuery = {}): Promise<TaskStepRecord[]> {
      const result = await options.client.query<TaskStepRow>(`
        select
          sequence::text as sequence,
          task_id,
          attempt,
          kind,
          label,
          meta,
          progress_percent,
          created_at
        from ${names.stepsQualified}
        where task_id = $1
        order by sequence asc
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
      const statuses = input.openOnly === false
        ? null
        : ["queued", "claimed", "running"];
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
          const openCount = Number(count.rows[0]?.count || "0");
          if (openCount >= input.globalConcurrency) {
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

          const claimToken = nowIso().replace(/[-:.TZ]/g, "").slice(0, 20);
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
              last_heartbeat_at = $2::timestamptz
            where id = $1
              and status = 'queued'
            returning *
          `, [
            row.id,
            nowIso(input.now),
            input.runnerId,
            claimToken,
            nowIso(Date.now() + input.leaseMs),
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
          updated_at = now()
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
          updated_at = $5::timestamptz
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
          label,
          meta,
          progress_percent,
          created_at
        )
        select
          id,
          $4,
          $5,
          $6,
          $7::jsonb,
          $8,
          $9::timestamptz
        from ${names.tasksQualified}
        where id = $1
          and lease_owner = $2
          and lease_token = $3
        returning
          sequence::text as sequence,
          task_id,
          attempt,
          kind,
          label,
          meta,
          progress_percent,
          created_at
      `, [
        input.taskId,
        input.runnerId,
        input.leaseToken,
        input.attempt,
        input.kind ?? "step",
        input.label,
        JSON.stringify(input.meta ?? null),
        clampPercent(input.progressPercent),
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
          updated_at = $7::timestamptz
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
          lease_expires_at = null
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
          lease_expires_at = null
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
      const reason = input.reason ? toErrorShape({
        message: input.reason,
        code: "TASK_CANCELLED",
      }) : toErrorShape({
        message: "Task cancelled",
        code: "TASK_CANCELLED",
      });

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
            updated_at = $3::timestamptz
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
      const reason = input.reason ? toErrorShape({
        message: input.reason,
        code: "TASK_CANCELLED",
      }) : toErrorShape({
        message: "Task cancelled",
        code: "TASK_CANCELLED",
      });
      const result = await options.client.query<TaskRow>(`
        update ${names.tasksQualified}
        set
          status = 'cancelled',
          error = $4::jsonb,
          finished_at = $5::timestamptz,
          updated_at = $5::timestamptz,
          lease_owner = null,
          lease_token = null,
          lease_expires_at = null
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
          updated_at = now(),
          lease_owner = null,
          lease_token = null,
          lease_expires_at = null
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
              lease_expires_at = null
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
            updated_at = $3::timestamptz,
            lease_owner = null,
            lease_token = null,
            lease_expires_at = null
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
  };
}

export {
  createPostgresTaskStore,
  createPostgresTaskStoreSchema,
};
