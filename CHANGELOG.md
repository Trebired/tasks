# Changelog

## 0.2.0

- Expanded the package-owned observability surface around durable tasks, including normalized progress state, persisted steps, bootstrap-plus-live subscription flows, aggregate reads, stale state, retention helpers, and the tiny live tracker.
- Added first-class live filtering by durable task keys such as `dedupeKey`, `concurrencyKey`, and `supersedeKey`, plus broader generic channel helpers for `topic`, `resource`, and `correlation`.
- Kept the runtime model host-owned and generic, with Postgres storage, child-process execution and optional Socket.IO-style bridging.

## 0.1.0

- Initial public release of `@trebired/tasks`
- Durable task host with Postgres storage and child-process execution
- Built-in progress snapshots, normalized task steps, aggregate reads, live bootstrap/subscription helpers, stale state, and retention helpers
