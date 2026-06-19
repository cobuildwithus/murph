# Computer-Use ReviewGPT Round 9 Fix

## Goal

Resolve accepted ReviewGPT round 9 findings on PR 214 with the smallest
durable changes:

- keep initial provisioning cleanup retryable when compensating Kernel browser
  deletion fails
- prevent account deletion from succeeding while browser/profile provisioning is
  still in flight
- remove write-only computer-run lifecycle fields if the deletion stays local
  and behavior-preserving

## Constraints

- Keep browser ownership recoverable through the existing durable run row and
  deterministic Kernel browser name.
- Do not add another broad lifecycle layer; reuse `cleanup_pending` and the
  existing stale windows where possible.
- Preserve member suspension as the deletion gate.
- Run focused tests, typecheck, full web verification, and a scoped privacy
  scan before committing.

## Working Set

- `apps/web/src/lib/computer-use/service.ts`
- `apps/web/src/lib/computer-use/store.ts`
- `apps/web/src/lib/hosted-privacy/account-data-service.ts`
- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/2026061700_hosted_computer_use/migration.sql`
- focused hosted computer-use/privacy tests

## Verification Plan

- Focused regression tests for ambiguous initial provisioning cleanup and
  account deletion in-flight provisioning.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-execution-computer-use.test.ts apps/web/test/hosted-account-data-service.test.ts`
- `pnpm run lint` from `apps/web`
- `pnpm run typecheck` from `apps/web`
- `pnpm run verify` from `apps/web`
- `pnpm run typecheck` from `packages/hosted-execution`
- `pnpm run test` from `packages/hosted-execution`
- `git diff --check`
- scoped diff privacy/path scan
- Push and rerun ReviewGPT on PR 214.

## Current State

- Implemented:
  - failed initial provisioning keeps the browserless run in `cleanup_pending`
    when compensating Kernel browser deletion fails
  - account-deletion external cleanup fails closed for fresh browserless
    provisioning and fresh checkpointing handoffs, and recovers stale
    browserless provisioning through the existing deterministic browser name
  - removed write-only computer-run checkpoint/auth/resume fields and the
    unused computer-handoff `revoked` state from the initial migration,
    schema, shared contract, store, export, and tests
- Verification passed:
  - focused hosted computer-use/account-data Vitest suites: 114 passed
  - web lint
  - web typecheck
  - full web verify: lint/tests/build passed; existing Turbopack NFT warning
    still appears during build
  - hosted-execution typecheck and tests: 177 passed
  - `git diff --check`
  - scoped privacy/path scan
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
