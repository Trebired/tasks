# @trebired/tasks

Durable background task host for Bun and Node.js applications.

`@trebired/tasks` gives a host application ownership over a real persisted task engine:

- queued, claimed, running, succeeded, failed, and cancelled task states
- durable task records and ordered progress steps
- retries, attempt tracking, lease heartbeats, and stale recovery
- dedupe and concurrency controls
- pluggable execution backends
- a default child-process executor that works cleanly across Node and Bun hosts

It is intentionally generic. It does not know about apps, deployments, repositories, agents, UI frameworks, sockets, or product-specific entity models.

In plain terms:

- it is a durable task infrastructure layer you embed into your host
- it is not a product-specific job catalog
- it is not tied to Redis
- it is not built around worker threads or Piscina

## Install

Runtime support: Bun 1+ and Node.js 18+.

```sh
npm install @trebired/tasks
```

For the first durable adapter:

```sh
npm install pg
```

## Quick Start

Define a task handler in a normal module:

```ts
import { defineTaskHandler } from "@trebired/tasks";

export default defineTaskHandler<{ reportId: string }, { outputPath: string }>({
  async run(input, context) {
    await context.setProgress({
      percent: 10,
      label: "loading inputs",
    });

    await context.appendStep({
      label: `Preparing report ${input.reportId}`,
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    await context.setProgress({
      percent: 100,
      label: "done",
      meta: {
        reportId: input.reportId,
      },
    });

    return {
      outputPath: `/tmp/reports/${input.reportId}.json`,
    };
  },
});
```

Create a Postgres-backed host and start the runner:

```ts
import { Pool } from "pg";
import {
  createPostgresTaskStore,
  createPostgresTaskStoreSchema,
  createTaskHost,
} from "@trebired/tasks";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

await pool.query(createPostgresTaskStoreSchema());

const tasks = createTaskHost({
  store: createPostgresTaskStore({
    client: pool,
  }),
  handlers: [
    {
      kind: "report.generate",
      entrypoint: {
        module: new URL("./handlers/report_task.ts", import.meta.url),
      },
      concurrency: {
        limit: 2,
      },
      retry: {
        maxAttempts: 3,
      },
    },
  ],
  runner: {
    globalConcurrency: 4,
  },
});

await tasks.start();

const queued = await tasks.enqueue("report.generate", {
  reportId: "rpt_42",
}, {
  dedupeKey: "report:rpt_42",
  concurrencyKey: "report:rpt_42",
});

console.log(queued.task.id, queued.deduplicated);
```

Read task state and ordered steps through the host:

```ts
const task = await tasks.getTask(queued.task.id);
const steps = await tasks.listTaskSteps(queued.task.id);

console.log(task?.status, task?.progressPercent, steps.length);
```

## Lifecycle And Ownership Model

The package owns the task engine and the task state machine.

The host owns:

- which task kinds exist
- which handlers are registered
- which storage adapter is used
- when runners start and stop
- how progress is surfaced to HTTP, websockets, polling, logs, or custom transports

The package owns:

- task records
- leasing and heartbeats
- stale lease recovery
- retry scheduling
- concurrency and dedupe checks
- progress snapshots and ordered step persistence
- executor abstraction and execution lifecycle

That split is deliberate. `@trebired/tasks` is meant to be the durable infrastructure underneath host-owned product behavior, not a replacement for product behavior.

## What The Main Host API Looks Like

Create one host:

```ts
import { createTaskHost } from "@trebired/tasks";

const tasks = createTaskHost({
  store,
  handlers,
});
```

Main methods:

- `tasks.start()`
- `tasks.stop()`
- `tasks.registerHandler(handler)`
- `tasks.enqueue(kind, input, options?)`
- `tasks.getTask(taskId)`
- `tasks.listTasks(query?)`
- `tasks.listTaskSteps(taskId, query?)`
- `tasks.cancel(taskId, reason?)`
- `tasks.onEvent(listener)`
- `tasks.getState()`

The host event stream is intentionally generic. It can be wired into logs, polling invalidation, websocket fanout, SSE, or any other host transport without the package needing to know about that transport.

## Task Model

The built-in state model is:

- `queued`
- `claimed`
- `running`
- `succeeded`
- `failed`
- `cancelled`

Each task record stores:

- `kind`
- `input`
- `output`
- `error`
- `attempt`
- `maxAttempts`
- `progressPercent`
- `progressLabel`
- `progressMeta`
- `concurrencyKey`
- `dedupeKey`
- lease ownership and heartbeat timestamps
- terminal timestamps and cancellation markers

Ordered steps are persisted separately and can be listed through `listTaskSteps()`.

## Storage Adapter Model

The core engine depends on a `TaskStore` contract. The first durable adapter is Postgres.

Use the shipped schema helper:

```ts
import { createPostgresTaskStoreSchema } from "@trebired/tasks";

const sql = createPostgresTaskStoreSchema({
  schema: "public",
  tablePrefix: "tb_",
});
```

Then create the adapter:

```ts
import { createPostgresTaskStore } from "@trebired/tasks";

const store = createPostgresTaskStore({
  client: pool,
});
```

The first adapter targets `pg`-style pool objects with:

- `query(sql, params?)`
- `connect()`
- pooled client `release()`

That keeps the task engine generic while still giving the Postgres adapter real transaction ownership for claim, lease, and dedupe behavior.

The store contract owns:

- create task
- read task
- list/query tasks
- claim next task with lease
- renew lease heartbeat
- append ordered steps
- update progress snapshot
- mark succeeded
- mark failed
- cancel or mark cancelled
- retry requeue
- stale recovery requeue
- dedupe lookup

## Concurrency And Dedupe

The engine supports three separate controls:

- global runner concurrency through `runner.globalConcurrency`
- per-kind concurrency through `handler.concurrency.limit`
- per-key serialization through `enqueue(..., { concurrencyKey })`

Use `dedupeKey` when a host wants repeat enqueue attempts to collapse onto one open task record:

```ts
const queued = await tasks.enqueue("import.users", payload, {
  dedupeKey: "import:users:2026-06-21",
});

if (queued.deduplicated) {
  console.log("existing open task reused", queued.task.id);
}
```

`concurrencyKey` is separate from `dedupeKey` on purpose:

- `dedupeKey` prevents duplicate open tasks
- `concurrencyKey` allows multiple tasks to exist while still forcing one-at-a-time execution for the same resource key

## Progress And Recovery Behavior

Task handlers report progress through the context they receive at execution time:

```ts
await context.setProgress({
  percent: 35,
  label: "transcoding",
  meta: {
    frame: 1820,
  },
});

await context.appendStep({
  label: "Source downloaded",
});
```

The engine persists:

- latest progress snapshot
- ordered steps/events
- attempt count
- last structured error
- terminal structured result

Recovery behavior includes:

- lease heartbeats while work is running
- stale lease detection and requeue after host restart or crash
- retry scheduling with `maxAttempts`
- simple exponential backoff by default when `retry.maxAttempts > 1`
- custom retry scheduling through `retry.backoff`

## Executor Model

The core engine does not assume worker threads.

Execution is abstracted behind a `TaskExecutor` contract, and the first implementation is `createChildProcessTaskExecutor()`. That is the default used by `createTaskHost()` when you do not pass a custom executor.

Why child process first:

- it works in both Bun and Node hosts without making worker-thread behavior the package boundary
- it isolates crashes and heavy work better than in-process execution
- it keeps the handler contract module-based and runtime-agnostic
- it does not force a Piscina dependency into Bun-first or mixed-runtime hosts

Why Piscina is not the core architecture:

- Piscina is a good future adapter for Node-specific worker-thread use cases
- worker threads are not available with the same assumptions across Bun and Node
- making Piscina the core would leak Node-specific execution decisions into the package model

In other words, child process is the conservative default because it preserves portability at the package boundary. Piscina can fit later as an optional executor adapter without redefining the package.

## Handler Module Contract

Handlers are module-backed on purpose. That makes them usable by the default child-process executor and by future executors that also want importable task modules.

```ts
import { defineTaskHandler } from "@trebired/tasks";

export const imageResizeTask = defineTaskHandler({
  async run(input, context) {
    await context.appendStep({
      label: "resize starting",
    });

    return resizeImage(input, context.signal);
  },
});
```

Register the handler with a kind and entrypoint:

```ts
tasks.registerHandler({
  kind: "image.resize",
  entrypoint: {
    module: new URL("./tasks/image_resize.ts", import.meta.url),
    export: "imageResizeTask",
  },
  retry: {
    maxAttempts: 3,
  },
});
```

Use `new URL(..., import.meta.url)` whenever possible. It is the most robust way to point the executor at a real module file.

## Current API

The first public slice is intentionally small:

```ts
import {
  createChildProcessTaskExecutor,
  createPostgresTaskStore,
  createPostgresTaskStoreSchema,
  createTaskHost,
  defineTaskHandler,
} from "@trebired/tasks";
```

Core exported types include:

- `TaskHost`
- `TaskStore`
- `TaskRecord`
- `TaskStepRecord`
- `TaskHandlerRegistration`
- `TaskHandlerModule`
- `TaskRetryPolicy`
- `TaskExecutor`

## Examples

Separate producer and runner processes:

```ts
const producer = createTaskHost({
  store,
});

const runner = createTaskHost({
  store,
  handlers: [
    {
      kind: "video.transcode",
      entrypoint: {
        module: new URL("./handlers/transcode_task.ts", import.meta.url),
      },
      retry: {
        maxAttempts: 2,
      },
    },
  ],
});

await runner.start();

const queued = await producer.enqueue("video.transcode", {
  assetId: "asset_7",
});
```

Subscribe to local host events:

```ts
const unsubscribe = tasks.onEvent((event) => {
  if (event.type === "task:progress") {
    console.log(event.taskId, event.task?.progressPercent, event.task?.progressLabel);
  }
});
```

Cancel a queued or running task:

```ts
await tasks.cancel(taskId, "user requested cancellation");
```

## Notes And Limitations

- The first durable adapter is Postgres only.
- The first executor is child-process based. Worker-thread and Piscina adapters can fit later behind the same `TaskExecutor` contract.
- Live cross-process subscriptions are intentionally host-owned. The package gives you durable reads and local host events, not a built-in socket layer.
- Node child-process handlers should point at runnable JavaScript modules unless your host already provides a loader for TypeScript modules. Bun can run `.ts` entrypoints directly.
- The Postgres adapter expects a `pg`-style pool with transaction-capable `connect()`. That keeps claim and lease logic deliberate instead of pretending a stateless query function is enough.
