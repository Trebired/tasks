# @trebired/tasks

Durable background task host for Bun and Node.js applications, with built-in progress state, step replay, live subscription bootstrap, stale detection, and pluggable execution backends.

`@trebired/tasks` is the generic Trebired package for hosts that need real background work outside the request path without rebuilding the whole task observability layer around it later.

It owns:

- durable task records
- claiming, leasing, heartbeats, retries, and stale recovery
- normalized progress state
- ordered task steps
- snapshot and replay reads
- aggregate task state
- normalized lifecycle events
- live subscribe-plus-bootstrap flows
- optional transport and client-side helpers

It stays intentionally generic.

It does not know about products, deployments, repositories, publications, agents, server panels, or app-specific UI wording.

In plain terms:

- it is a durable task infrastructure and observability layer you embed into your host
- it is not a hosted queue service
- it is not tied to Redis
- it is not built around worker threads or Piscina
- it does not force Socket.IO, React, or a specific web framework into the core

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
      level: "info",
      message: `Preparing report ${input.reportId}`,
      percent: 10,
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

Create a Postgres-backed host and start a runner:

```ts
import { Pool } from "pg";
import {
  createPostgresTaskStore,
  preparePostgresTaskStoreSchema,
  createTaskHost,
  taskChannel,
} from "@trebired/tasks";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

await preparePostgresTaskStoreSchema({
  client: pool,
});

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
    watchdogMs: 60_000,
  },
});

await tasks.start();

const queued = await tasks.enqueue("report.generate", {
  reportId: "rpt_42",
}, {
  dedupeKey: "report:rpt_42",
  concurrencyKey: "report:rpt_42",
  channels: [
    taskChannel.scope("workspace:42"),
    taskChannel.scope("reports"),
  ],
});

console.log(queued.task.id, queued.disposition);
```

Read the current snapshot and recent steps:

```ts
const snapshot = await tasks.readSnapshot(queued.task.id, {
  includeSteps: 20,
});

console.log(snapshot?.state, snapshot?.progress.percent, snapshot?.steps?.length);
```

## Lifecycle And Ownership Model

The host still owns:

- what each task kind actually does
- which permissions gate enqueue or subscribe access
- how task state is rendered in UI
- whether lifecycle data is mirrored into logs, metrics, or app-specific diagnostics

The package owns:

- task state transitions
- durable progress state
- step persistence and replay
- dedupe and supersedence mechanics
- live lifecycle normalization
- snapshot bootstrap for current state
- stale/watchdog state
- retention helpers

That split is deliberate. Apps should not need to rebuild generic task observability every time they add progress panels or live dashboards.

## Task Model

The persisted task record still has the core durable states:

- `queued`
- `claimed`
- `running`
- `succeeded`
- `failed`
- `cancelled`

On top of that, the package now exposes a first-class lifecycle/progress state model:

- `queued`
- `claimed`
- `running`
- `retrying`
- `succeeded`
- `failed`
- `cancelled`
- `stale`

`retrying` and `stale` are package-owned lifecycle states that sit above the lower-level persisted status.

That means a host can build UI against `snapshot.state` instead of reverse-engineering retry and stale semantics from multiple raw fields.

## Progress Model

Every snapshot includes a normalized progress contract:

```ts
type TaskProgressState = {
  state: TaskLifecycleState;
  percent: number | null;
  label: string | null;
  meta: Record<string, unknown> | null;
  startedAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
  retryScheduledAt: string | null;
  staleAt: string | null;
  staleReason: string | null;
  lastHeartbeatAt: string | null;
};
```

Handlers update the task-facing parts of that model through:

```ts
await context.setProgress({
  percent: 35,
  label: "transcoding",
  meta: {
    frame: 1820,
  },
});
```

The engine owns the lifecycle-facing parts such as:

- `state`
- `startedAt`
- `finishedAt`
- `retryScheduledAt`
- `staleAt`
- `lastHeartbeatAt`

## Steps Model

Task steps are first-class persisted records, not just an app convention:

```ts
type TaskStepRecord = {
  id: string;
  taskId: string;
  attempt: number;
  kind: TaskStepKind;
  level: TaskStepLevel;
  message: string;
  meta: Record<string, unknown> | null;
  percent: number | null;
  createdAt: string;
};
```

Handlers append them through:

```ts
await context.appendStep({
  level: "info",
  kind: "checkpoint",
  message: "Source downloaded",
  percent: 20,
});
```

These steps are normalized the same way whether they came from a child-process executor, a future custom executor, or host-owned testing infrastructure.

## Snapshots, Replay, And Aggregate Reads

The host now exposes package-owned read APIs for UI and dashboard usage:

- `tasks.readSnapshot(taskId, { includeSteps? })`
- `tasks.listSnapshots(query?)`
- `tasks.readAggregate(query?)`
- `tasks.bootstrap(query?)`

That means an app can ask for:

- the current task snapshot for a modal or detail panel
- recent steps for replay
- current aggregate counts for a dashboard
- a bootstrap payload for subscribe-plus-live flows

Example:

```ts
const bootstrap = await tasks.bootstrap({
  channels: [
    taskChannel.scope("workspace:42"),
  ],
  recentSteps: 25,
});

console.log(bootstrap.snapshots.length, bootstrap.aggregate?.byState.running);
```

## Channel And Scope Model

`@trebired/tasks` now has a package-owned channel model for grouping tasks and subscriptions.

Built-in helpers:

```ts
import { taskChannel } from "@trebired/tasks";

taskChannel.task("task_42");
taskChannel.kind("report.generate");
taskChannel.topic("imports");
taskChannel.resource("repo:42");
taskChannel.correlation("request:abc");
taskChannel.dedupe("report:rpt_42");
taskChannel.concurrency("report:rpt_42");
taskChannel.supersede("scan:repo_7");
taskChannel.scope("workspace:42");
```

Tasks can also carry extra host-defined channels directly:

```ts
await tasks.enqueue("report.generate", input, {
  channels: [
    taskChannel.scope("workspace:42"),
    taskChannel.scope("sidebar"),
  ],
});
```

This keeps subscription routing generic and typed without forcing every app to invent its own free-form key naming scheme.

Subscription queries can also filter directly by package-owned keys:

```ts
const bootstrap = await tasks.bootstrap({
  dedupeKey: "report:rpt_42",
  concurrencyKey: "report:rpt_42",
  supersedeKey: "scan:repo_7",
});
```

## Live Subscription Model

The package now ships a generic live hub for real-time UI flows:

```ts
import { createTaskLiveHub } from "@trebired/tasks";

const hub = createTaskLiveHub(tasks);
```

Main methods:

- `hub.bootstrap(query?)`
- `hub.subscribe(query, listener)`

The live hub delegates bootstrap reads back to the host, so polling, direct reads, and live subscribe-plus-bootstrap all share one canonical snapshot path.

The flow is intentionally explicit:

1. client or transport subscribes with a query
2. the listener immediately receives a bootstrap payload
3. the listener then receives normalized live updates

The messages are transport-neutral:

```ts
type TaskLiveMessage =
  | {
      type: "bootstrap";
      query: TaskSubscriptionQuery;
      snapshots: TaskSnapshot[];
      steps: Record<string, TaskStepRecord[]>;
      aggregate: TaskAggregateSnapshot | null;
      timestamp: string;
    }
  | {
      type: "event";
      event: TaskLifecycleEvent;
      timestamp: string;
    };
```

## Normalized Lifecycle Events

Apps no longer need to translate low-level host events into UI-friendly lifecycle updates.

The host exposes:

- `tasks.onEvent(listener)` for lower-level host events
- `tasks.onLifecycleEvent(listener)` for normalized lifecycle events

Lifecycle event names:

- `enqueued`
- `claimed`
- `started`
- `progress`
- `step`
- `retried`
- `succeeded`
- `failed`
- `cancelled`
- `stale`
- `lease_lost`

Each normalized event carries the current snapshot when one exists, plus the step record for step events.

## Generic Event Entries And Adapters

When a consumer wants timeline rows, log entries, websocket payloads, or diagnostics records, the package now exposes presentation-friendly event entry helpers too:

```ts
import {
  createTaskLifecycleEventAdapter,
  normalizeTaskHostEventEntry,
} from "@trebired/tasks";
```

The normalized entry shape stays generic:

```ts
type TaskEventEntry = {
  type: TaskEventEntryType;
  level: TaskStepLevel;
  message: string;
  percent: number | null;
  timestamp: string;
  metadata: Record<string, unknown> | null;
  runnerId: string | null;
  taskId: string | null;
  kind: string | null;
  state: TaskLifecycleState | null;
  channels: string[];
  stepId: string | null;
};
```

Use the direct normalizers when you already have an event object:

```ts
const entry = normalizeTaskHostEventEntry(event);
console.log(entry.type, entry.message, entry.percent);
```

Use the adapters when you want to forward normalized entries straight into another sink:

```ts
tasks.onLifecycleEvent(createTaskLifecycleEventAdapter((entry) => {
  publishToTimeline(entry);
}));
```

This keeps event parsing package-owned while still letting each host choose its own logging, websocket, notification, or storage layer.

## Bootstrap Plus Replay Flow

The preferred real-time flow is:

1. build a query by task id, kind, or channels
2. call `hub.subscribe(query, listener)`
3. use the bootstrap snapshot immediately
4. apply later live events on top

Example:

```ts
const unsubscribe = await hub.subscribe({
  channels: [
    taskChannel.scope("workspace:42"),
  ],
  recentSteps: 50,
}, (message) => {
  if (message.type === "bootstrap") {
    console.log(message.snapshots.length);
    return;
  }

  console.log(message.event.event, message.event.snapshot?.progress.percent);
});
```

That bootstrap-first model is package-owned specifically so apps do not need to invent one-off “give me current state, then also subscribe” protocols every time.

## Tiny Client Helper

For framework-agnostic client-side state, use:

```ts
import { createTaskLiveTracker } from "@trebired/tasks";

const tracker = createTaskLiveTracker();

await hub.subscribe(query, (message) => {
  tracker.apply(message);
});

const state = tracker.getState();
console.log(state.snapshots[0]?.progress.percent);
```

The tracker owns:

- bootstrap application
- later event application
- snapshot replacement
- step accumulation
- aggregate refresh from current snapshots

It stays intentionally small. It does not assume React, Vue, Svelte, or a browser runtime.

## Optional Socket.IO Bridge

The core live model does not hardcode Socket.IO.

If a host already uses Socket.IO-style transport, `attachTaskLiveSocketBridge()` can wire the live hub into a socket server without pulling Socket.IO into the rest of the package model:

```ts
import {
  attachTaskLiveSocketBridge,
  createTaskLiveHub,
} from "@trebired/tasks";

const hub = createTaskLiveHub(tasks);

attachTaskLiveSocketBridge(io, {
  hub,
  subscribeEvent: "tasks:subscribe",
  publishEvent: "tasks:live",
});
```

The bridge expects a Socket.IO-like shape through duck typing. The package does not require a direct runtime dependency on `socket.io`.

## Dedupe And Supersedence

Deduplication is now surfaced explicitly through the enqueue result:

```ts
const result = await tasks.enqueue("import.users", payload, {
  dedupeKey: "import:users:2026-06-21",
});

console.log(result.disposition);
```

Possible enqueue dispositions:

- `created`: a new task record was created
- `reused`: an existing open task was reused
- `superseded`: a new task was created and older matching active tasks were replaced

Use supersedence when the newest task should replace older open work:

```ts
const result = await tasks.enqueue("scan.repository", payload, {
  supersedeKey: "repo:42",
  supersedeExisting: true,
});

console.log(result.supersededTaskIds);
```

This is useful for “already in progress” and “newer request replaced older request” UX without each app inventing its own semantics.

## Stale And Watchdog Behavior

The package now owns stale/watchdog mechanics too.

Runner options:

```ts
const tasks = createTaskHost({
  store,
  runner: {
    watchdogMs: 60_000,
    watchdogScanIntervalMs: 5_000,
  },
});
```

What that means:

- if a claimed or running task stops reporting heartbeat or progress for too long, it can become `stale`
- stale state is reflected in snapshots through `progress.staleAt` and `progress.staleReason`
- normalized lifecycle can emit `stale`
- expired leases can still be requeued separately through the durable recovery path

In practice this lets UIs show:

- “still running”
- “retry scheduled”
- “stale, runner may be gone”

without app-owned timeout heuristics.

## Persistence Policy Helpers

The store now exposes a package-owned retention interface:

```ts
await tasks.compact({
  successTtlMs: 7 * 24 * 60 * 60 * 1000,
  failedTtlMs: 30 * 24 * 60 * 60 * 1000,
  stepLimitPerTask: 200,
  keepLatestSuccessesPerKind: 20,
  keepLatestFailuresPerKind: 20,
});
```

Runner-managed automatic compaction is also supported through:

```ts
const tasks = createTaskHost({
  store,
  runner: {
    retentionPolicy: {
      successTtlMs: 7 * 24 * 60 * 60 * 1000,
      stepLimitPerTask: 200,
    },
    retentionScanIntervalMs: 60_000,
  },
});
```

This covers generic retention concerns such as:

- step history limits
- TTL-based cleanup
- keeping only recent successes or failures per kind

## Storage Adapter Model

The core engine depends on a `TaskStore` contract. The first durable adapter is Postgres.

Use the package-owned schema preparation helper during startup:

```ts
import { preparePostgresTaskStoreSchema } from "@trebired/tasks";

await preparePostgresTaskStoreSchema({
  client: pool,
  schema: "public",
  tablePrefix: "tb_",
});
```

That path is:

- idempotent
- safe to call repeatedly on boot
- responsible for fresh schema creation and additive package-owned upgrades

If the host wants the raw SQL for inspection or external migrations, the package still exposes:

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

The first adapter targets `pg`-style pools with:

- `query(sql, params?)`
- `connect()`
- pooled client `release()`

That keeps claim and lease behavior transaction-owned instead of pretending a stateless query function is enough for a durable task engine.

## Executor Model

The core engine still does not assume worker threads.

Execution is abstracted behind `TaskExecutor`.

The package now ships two first-class generic executors:

- `createChildProcessTaskExecutor()`
- `createInProcessTaskExecutor()`

Use the in-process executor when the host wants task execution in the current runtime:

```ts
import {
  createInProcessTaskExecutor,
  createTaskHost,
} from "@trebired/tasks";

const tasks = createTaskHost({
  store,
  handlers,
  executor: createInProcessTaskExecutor(),
});
```

The in-process executor owns:

- handler module loading and export resolution
- cooperative cancellation through `AbortSignal`
- progress and step forwarding
- normalized failure shaping

The default still remains `createChildProcessTaskExecutor()`.

Why child process first:

- it works cleanly across Bun and Node hosts
- it keeps the package boundary runtime-agnostic
- it isolates heavy work and crashes better than in-process execution
- it avoids making Node-specific worker-thread behavior the default mental model

Why Piscina is still only a future optional adapter:

- Piscina is useful for Node-specific worker-thread workloads
- Bun and Node do not share the same worker-thread assumptions
- making Piscina the core would leak a runtime-specific execution choice into the package’s main API

In other words, child process is the conservative generic default. Piscina can fit later as an adapter without redefining the package.

Why in-process is still not the default:

- cancellation is cooperative, so the handler must respect `AbortSignal`
- heavy synchronous work can still block the host event loop
- process isolation is still the safer default for generic package-owned execution

## Core API

Main host entrypoint:

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
- `tasks.readSnapshot(taskId, options?)`
- `tasks.listSnapshots(query?)`
- `tasks.readAggregate(query?)`
- `tasks.bootstrap(query?)`
- `tasks.cancel(taskId, reason?)`
- `tasks.compact(policy?)`
- `tasks.onEvent(listener)`
- `tasks.onLifecycleEvent(listener)`
- `tasks.getState()`

## Progress Bar Example

For a progress bar, the snapshot model is enough:

```ts
const snapshot = await tasks.readSnapshot(taskId);

const percent = snapshot?.progress.percent ?? 0;
const label = snapshot?.progress.label || snapshot?.state || "queued";
```

With live updates:

```ts
await hub.subscribe({
  taskIds: [taskId],
}, (message) => {
  tracker.apply(message);
  const current = tracker.getState().snapshots[0];
  renderProgressBar(current?.progress.percent || 0, current?.progress.label || current?.state || "queued");
});
```

## Live Modal Or Task Panel Example

For a current-task panel, the usual flow is:

```ts
await hub.subscribe({
  channels: [
    taskChannel.scope("workspace:42"),
  ],
  recentSteps: 100,
}, (message) => {
  tracker.apply(message);
  const state = tracker.getState();
  renderTaskPanel({
    tasks: state.snapshots,
    steps: state.steps,
    aggregate: state.aggregate,
  });
});
```

That gives the panel:

- current task states
- ordered recent steps per task
- aggregate counts for summary badges

without app-owned event reconstruction.

## Current API

The first public slice is still deliberate rather than huge:

```ts
import {
  attachTaskLiveSocketBridge,
  createChildProcessTaskExecutor,
  createInProcessTaskExecutor,
  createPostgresTaskStore,
  preparePostgresTaskStoreSchema,
  createPostgresTaskStoreSchema,
  createTaskHostEventAdapter,
  createTaskHost,
  createTaskLifecycleEventAdapter,
  createTaskLiveHub,
  createTaskLiveTracker,
  defineTaskHandler,
  normalizeTaskHostEventEntry,
  normalizeTaskLifecycleEventEntry,
  taskChannel,
} from "@trebired/tasks";
```

Important exported types include:

- `TaskRecord`
- `TaskSnapshot`
- `TaskProgressState`
- `TaskStepRecord`
- `TaskLifecycleEvent`
- `TaskEventEntry`
- `TaskSubscriptionQuery`
- `TaskSubscriptionBootstrap`
- `TaskStore`
- `TaskExecutor`
- `TaskRetentionPolicy`

## Examples

Durable Postgres + child-process execution:

- [examples/postgres_child_process.ts](/home/mirmachynka/projects/serious/npm/tasks/examples/postgres_child_process.ts)

Live bootstrap + tracker flow:

- [examples/live_updates.ts](/home/mirmachynka/projects/serious/npm/tasks/examples/live_updates.ts)

## Notes And Limitations

- The first durable adapter is Postgres only.
- The default executor is child-process based. Worker-thread and Piscina adapters can be added later behind the same `TaskExecutor` contract.
- The Socket.IO bridge is intentionally thin and optional. The core live contract remains transport-agnostic.
- Node child-process handlers should usually point at runnable JavaScript modules unless the host already provides a loader for TypeScript modules. Bun can run `.ts` task entrypoints directly.
- The retention helpers are generic package-owned policies, not a replacement for app-specific archival decisions.
