# Changelog

## 1.1.0

- Added a backend-agnostic public storage happy path with `createTaskStore(...)`, `prepareTaskStoreSchema(...)`, and `createTaskStoreSchema(...)`, with backend selection driven by explicit `driver` options instead of backend names in the main API.
- Added a first-class built-in SQLite durable store for lightweight local hosts, including schema preparation, claiming, leasing, progress persistence, stale recovery, retries, retention, and durable step history.
- Kept the explicit backend adapters available for hosts that want them directly, while making the generic store factory the recommended package-owned integration path.

## 1.0.0

- Added a first-class in-process executor with package-owned handler module loading, cooperative cancellation, progress forwarding, step forwarding, and normalized error shaping.
- Added generic event entry helpers and adapter utilities so hosts can forward task host and lifecycle events into logs, timelines, transports, and diagnostics layers without rebuilding parsing logic.
- Added the package-owned `preparePostgresTaskStoreSchema()` startup helper for idempotent Postgres schema preparation and additive upgrades, including compatibility upgrades for older task tables missing `supersede_key`.

## 0.2.1

- Fixed the published tarball metadata so `main`, `types`, and package-private alias imports resolve to files that actually exist in the packed `dist` output.
- Added a publish-preparation step that promotes public `dist/src` entrypoints into `dist`, rewrites compiled alias imports to relative built files, and rewrites packed `package.json` metadata during `npm pack` and `npm publish`.
- Added an explicit pack verification step that inspects the tarball, checks packed entrypoint and alias targets, and smoke-tests install, typecheck, and runtime import from a clean temporary consumer project.

## 0.2.0

- Expanded the package-owned observability surface around durable tasks, including normalized progress state, persisted steps, bootstrap-plus-live subscription flows, aggregate reads, stale state, retention helpers, and the tiny live tracker.
- Added first-class live filtering by durable task keys such as `dedupeKey`, `concurrencyKey`, and `supersedeKey`, plus broader generic channel helpers for `topic`, `resource`, and `correlation`.
- Kept the runtime model host-owned and generic, with Postgres storage, child-process execution and optional Socket.IO-style bridging.

## 0.1.0

- Initial public release of `@trebired/tasks`
- Durable task host with Postgres storage and child-process execution
- Built-in progress snapshots, normalized task steps, aggregate reads, live bootstrap/subscription helpers, stale state, and retention helpers
