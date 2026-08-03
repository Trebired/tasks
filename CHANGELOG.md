# Changelog

All notable changes to `@trebired/tasks` will be documented here.

This project follows semantic versioning once published.

## 1.1.9

- Refreshed package dependency ranges and lockfile state with `bun update` after adopting the `.trebired/code-discipline` structure.

## 1.1.8

- Moved Code Discipline config, alias-map state, generated tsconfig paths, and reports to `.trebired/code-discipline/`.
- Updated the `@trebired/code-discipline` devDependency to `^4.10.0`.

## 1.1.7

- Updated Code Discipline configuration to the `imports` rule with dead import removal enabled.
- Updated tasks log group metadata fallback so package-owned logs stay under the organization root when package metadata is unavailable.
- Updated internal package dependency ranges to the current published sibling releases.

## 1.1.6

- Fixed a broken published-package build: a fresh checkout has no committed `.code-discipline/generated/` output, and nothing regenerated it before `typecheck`/`build`, so every internal `#hash` import failed to resolve. `typecheck` and `build` now run `prepare:generated` first.
- Standardized package metadata (author field, config-driven organization name, dropped the Node engine constraint) and migrated `.code-discipline/config.ts` to `defineCodeDisciplineConfig`.
- Normalized README structure and removed the license footer.
- Updated the `@trebired/code-discipline` devDependency to 4.8.0.

## 1.1.5

- Standardized package metadata ordering and contributing guidance around the Trebired writing style.
- Added package-owned organization metadata and derived task host log groups from `package.json`.
- Updated internal package dependency ranges to the current sibling package releases.

## 1.1.4

- Removed dead test scripts and stale test commands from publish workflows and maintainer docs.

## 1.1.3

- Removed package test suites and banned committed `*.spec.ts`/`*.spec.tsx` files through Code Discipline.
- Added Code Discipline enforcement for hardcoded `trebired` strings outside package metadata.
- Migrated Code Discipline to `.code-discipline/config.ts` with alias-map sync output.
- Updated package-generated artifact ignores and internal package dependency ranges.

## 1.1.2

- Moved package-owned task host logging under the `trebired.tasks` group root.

## 1.1.1

- adopt `@trebired/result` as the package-owned backend result surface for touched executor, storage, and runtime communication paths instead of local result wrappers
- continue enforcing current `@trebired/code-discipline` expectations across the touched examples, fixtures, and specs while preserving the public task host and store APIs

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
