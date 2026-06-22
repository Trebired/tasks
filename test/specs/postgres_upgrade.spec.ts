import { describe, expect, test } from "bun:test";

import {
  createTaskStoreSchema,
  createPostgresTaskStore,
  createPostgresTaskStoreSchema,
  prepareTaskStoreSchema,
  preparePostgresTaskStoreSchema,
} from "#8t8bq600b4wu";
import type {
  PostgresTaskPool,
  PostgresTaskPoolClient,
  PostgresTaskQueryResult,
} from "#2kjvrax0gr4m";

class LegacySupersedePool implements PostgresTaskPool {
  supersedeColumnReady = false;
  supersedeIndexReady = false;
  tasks = new Map<string, Record<string, unknown>>();

  async connect(): Promise<PostgresTaskPoolClient> {
    return {
      query: (sql, params) => this.query(sql, params),
      release: () => undefined,
    };
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<PostgresTaskQueryResult<T>> {
    const normalized = sql.toLowerCase();

    if (isTransactionStatement(normalized)) {
      return { rows: [] as T[] };
    }

    if (normalized.includes("add column if not exists") && normalized.includes("supersede_key")) {
      this.supersedeColumnReady = true;
    }

    if (normalized.includes("_supersede_key_idx")) {
      this.supersedeIndexReady = true;
    }

    if (normalized.includes("insert into") && normalized.includes("supersede_key")) {
      this.assertSupersedeColumnReady();
      return this.insertTask(params) as PostgresTaskQueryResult<T>;
    }

    if (normalized.includes("update") && normalized.includes("supersede_key")) {
      this.assertSupersedeColumnReady();
      return { rows: [] as T[] };
    }

    if (normalized.includes("dedupe_key")) {
      return { rows: [] as T[] };
    }

    return { rows: [] as T[] };
  }

  private insertTask(params: unknown[]): PostgresTaskQueryResult {
    const row = createTaskRow(params);
    this.tasks.set(String(row.id), row);
    return {
      rows: [row],
    };
  }

  private assertSupersedeColumnReady(): void {
    if (!this.supersedeColumnReady) {
      throw new Error('column "supersede_key" does not exist');
    }
  }
}

function isTransactionStatement(sql: string): boolean {
  return sql.startsWith("begin") || sql.startsWith("commit") || sql.startsWith("rollback");
}

function createTaskRow(params: unknown[]): Record<string, unknown> {
  return {
    id: params[0],
    kind: params[1],
    status: "queued",
    input: params[2],
    output: null,
    error: null,
    metadata: params[3],
    progress_percent: null,
    progress_label: null,
    progress_meta: null,
    concurrency_key: params[4],
    dedupe_key: params[5],
    supersede_key: params[6],
    channels: params[7],
    attempt: 0,
    max_attempts: params[8],
    scheduled_at: params[9],
    created_at: params[10],
    updated_at: params[10],
    claimed_at: null,
    started_at: null,
    finished_at: null,
    cancel_requested_at: null,
    lease_owner: null,
    lease_token: null,
    lease_expires_at: null,
    last_heartbeat_at: null,
    retry_scheduled_at: null,
    stale_at: null,
    stale_reason: null,
  };
}

describe("@trebired/tasks postgres upgrade", () => {
  test("adds supersede_key upgrade sql to the package-owned schema", () => {
    const sql = createPostgresTaskStoreSchema();
    const genericSql = createTaskStoreSchema({
      driver: "postgres",
    });

    expect(sql.includes("add column if not exists \"supersede_key\" text")).toBe(true);
    expect(sql.includes("create index if not exists \"tb_tasks_supersede_key_idx\"")).toBe(true);
    expect(sql.includes("where supersede_key is not null")).toBe(true);
    expect(genericSql).toBe(sql);
  });

  test("prepares older task tables so supersede-backed inserts stop failing", async () => {
    const client = new LegacySupersedePool();
    const store = createPostgresTaskStore({
      client,
    });

    const createInput = {
      id: "task_legacy_upgrade",
      kind: "report.generate",
      input: {
        reportId: "rpt_42",
      },
      supersedeKey: "report:rpt_42",
      maxAttempts: 1,
      scheduledAt: new Date().toISOString(),
    };

    await expect(store.createTask(createInput)).rejects.toThrow('column "supersede_key" does not exist');

    await preparePostgresTaskStoreSchema({
      client,
    });

    await prepareTaskStoreSchema({
      driver: "postgres",
      postgres: {
        client,
      },
    });

    await preparePostgresTaskStoreSchema({
      client,
    });

    const created = await store.createTask(createInput);

    expect(created.task.supersedeKey).toBe("report:rpt_42");
    expect(client.supersedeColumnReady).toBe(true);
    expect(client.supersedeIndexReady).toBe(true);
  });
});
