# Deepsec Maintainable Fixes

## Goal

Fix the confirmed Deepsec concurrency and bounded-query bugs with minimal architecture:

- Stable caller-supplied canonical IDs must not bypass the full canonical write lock.
- Scheduled-log upserts must resolve and write under one existing canonical resource lock.
- Experiment summary date expansion must fail fast on unrealistic windows.

## Constraints

- Reuse existing lock primitives; do not add a new locking framework.
- Keep the query guard as a small defensive bound, not a new experiment subsystem.
- Preserve unrelated working-tree edits and active rows.

## Working Set

- `packages/core/src/public-mutations.ts`
- `packages/core/src/scheduled-logs.ts`
- `packages/query/src/experiments.ts`
- Focused tests under the owning package test suites.

## Verification

- `pnpm typecheck`
- `pnpm test:diff packages/core/src/public-mutations.ts packages/core/src/scheduled-logs.ts packages/query/src/experiments.ts`
- `pnpm test:smoke`

Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
