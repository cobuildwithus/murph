# Computer-Use ReviewGPT Round 8 Fix

## Goal

Resolve accepted ReviewGPT round 8 findings on PR 214 without broadening the
computer-use architecture:

- remove the unused handoff opened marker that can race with completion claims
- recover stale browserless provisioning reservations before they block a
  member/profile for the full run TTL
- keep failed stale-provisioning cleanup retryable without allowing a
  replacement browser before deterministic Kernel cleanup succeeds

## Constraints

- Keep fixes at existing `apps/web` computer-use service/store boundaries.
- Prefer deletion and conditional state transitions over new coordination
  layers.
- Do not reintroduce transactions around Kernel network calls.
- Keep browser run ownership durable in Postgres and Kernel cleanup
  best-effort/idempotent.

## Working Set

- `apps/web/src/lib/computer-use/service.ts`
- `apps/web/src/lib/computer-use/store.ts`
- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/2026061700_hosted_computer_use/migration.sql`
- `packages/hosted-execution/src/computer-use.ts`
- focused hosted computer-use tests

## Verification Plan

- Focused regression tests for stale handoff-claim recovery and stale
  browserless provisioning recovery.
- `pnpm exec vitest run --config apps/web/vitest.config.ts <focused test file>`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web typecheck` or `pnpm verify:acceptance` if feasible.
- `pnpm --dir packages/hosted-execution typecheck`
- Required `security-privacy-review`, `coverage-write`, and `deep-review`
  passes for persisted state/trust-boundary changes.
- Push and rerun ReviewGPT on PR 214.

## Current State

- ReviewGPT round 8 returned two accepted high findings:
  - concurrent handoff page reads can advance `updatedAt` after a completion
    claim and strand the handoff in `checkpointing`
  - a crash after creating a browserless active run can block the profile until
    normal run expiry
- Local deep review found one additional high issue in the initial browserless
  recovery: cleanup failure terminalized the stale row before deterministic
  Kernel cleanup succeeded, so a retry could create a replacement browser.
- Implemented:
  - deleted the unused handoff `openedAt`/`markHandoffOpened` path
  - stale `checkpointing` handoff reads release/refetch instead of staying
    stranded
  - stale browserless `running` rows move to `cleanup_pending`, retry
    deterministic Kernel cleanup, then finish as failed only after cleanup
    succeeds
  - Kernel SDK request timeout is aligned to the web-control proxy budget
- Verification passed:
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-execution-computer-use.test.ts apps/web/test/hosted-account-data-service.test.ts apps/web/test/hosted-retention-cleanup.test.ts`
  - `pnpm --dir apps/web lint`
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir apps/web verify`
  - `pnpm --dir packages/hosted-execution typecheck`
  - `pnpm --dir packages/hosted-execution test`
  - `git diff --check`
  - scoped diff privacy scan for local identifiers/secrets returned no matches
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
