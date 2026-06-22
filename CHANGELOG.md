# Changelog

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
