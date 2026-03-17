# 2026-03-17 Vault Symlink Hardening

## Goal

Eliminate symlink breakout bugs in non-core vault path helpers by reusing core's on-disk vault containment checks for reads, writes, copies, and cleanup paths.

## Scope

- Replace duplicated lexical-only vault path resolvers in CLI, inboxd, and parsers.
- Harden the listed read/write/copy/remove/reset call sites that currently trust those helpers.
- Add regression coverage for symlink traversal rejection in CLI, export helper reads, inboxd persistence/rebuild, and parser artifact publication/cleanup.

## Constraints

- Preserve existing public CLI error codes/messages where feasible.
- Preserve unrelated in-flight edits in overlapping CLI files.
- Keep the scope to the listed helpers and their direct call sites.

## Planned Changes

1. Expose the needed core path-safety primitives from `@healthybob/core`.
2. Build package-local wrappers only where error translation is required, but delegate path safety to core's lexical and on-disk checks.
3. Update callers so read paths and destructive cleanup paths also perform the on-disk check before filesystem access.
4. Add explicit symlink breakout regression tests for each affected package area.

## Verification

- Required checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Completion workflow: `simplify` -> `test-coverage-audit` -> `task-finish-review`.
Status: completed
Updated: 2026-03-17
Completed: 2026-03-17
