# Contributing

Thanks for helping improve `@trebired/tasks`.

## Development Setup

```sh
bun install
```

The package is authored in TypeScript and published from `dist`.

## Common Commands

```sh
bun run typecheck
bun test
bun run build
```

## Pull Request Checklist

- Keep public API changes intentional and documented in `README.md`.
- Add or update tests for behavior changes.
- Run typecheck, tests, and build before opening a PR.
- Update `CHANGELOG.md` in the current release-prep section, or add a new `Unreleased` section when post-release work begins.
- Do not commit `dist` or generated package tarballs.

## Design Principles

- Keep the reusable task boundary smaller than the product-specific code around it.
- Keep task infrastructure generic and host-owned instead of encoding product concepts into the package.
- Keep durable state, leasing, retries, and recovery explicit and easy to inspect.
- Keep the executor boundary runtime-agnostic so Bun and Node hosts are both first-class.
- Prefer module-backed handlers over hidden globals or process-local magic.
- Avoid runtime dependencies unless they remove meaningful complexity.

## Release Process

1. Move `CHANGELOG.md` entries from `Unreleased` into a versioned section.
2. Update the package version:

   ```sh
   npm version patch
   ```

   Use `minor` or `major` instead of `patch` when appropriate.

3. Verify the package:

   ```sh
   bun run typecheck
   bun test
   bun run build
   npm pack --dry-run
   ```

4. Publish with:

   ```sh
   npm publish
   ```

`npm publish` runs `prepublishOnly`, which typechecks, tests, and builds before publishing.
