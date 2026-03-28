# Hosted Dispatch-Ref Ownership

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

Move the minimized hosted execution dispatch-ref contract ownership into `@murph/hosted-execution` while preserving the current by-reference outbox design in `apps/web`.

## Success criteria

- `@murph/hosted-execution` owns the dispatch-ref schema version, type, parser, and builder.
- `apps/web` keeps only Prisma JSON wrappers plus source-specific hydration and DB record handling.
- The outbox payload stored in Postgres remains a minimized dispatch ref and does not expand into full hosted execution payload bodies.
- Existing webhook-receipt minimization and hydration flows continue to rehydrate from the same by-reference contract.
- Focused tests prove contract parity and hydration/outbox behavior still align after the ownership move.

## Scope

- In scope:
  - `packages/hosted-execution` dispatch-ref contract module and exports
  - `apps/web` outbox payload wrapper/callers
  - focused hosted execution tests in `apps/web`
- Out of scope:
  - changing the hosted DB into a canonical payload store
  - widening minimized payload contents
  - moving hydration-by-source logic out of `apps/web`
  - changing Cloudflare dispatch ordering or hosted runtime behavior

## Constraints

- Preserve the `schemaVersion + dispatchRef` payload shape for execution outbox rows.
- Keep Prisma JSON concerns out of shared contracts.
- Preserve overlapping hosted onboarding and hosted execution edits already present in the worktree.
- Prefer temporary app-local re-exports where needed to keep the move incremental and low-risk.

## Risks

1. Accidentally widening outbox payloads or receipt side-effect payloads beyond minimized refs.
2. Letting Prisma JSON types leak into `packages/hosted-execution`.
3. Breaking parity between the shared dispatch builder/parser and `apps/web` hydration paths.

## Plan

1. Add a shared dispatch-ref module under `packages/hosted-execution` and export it.
2. Turn the app-local outbox payload file into a thin Prisma JSON wrapper around the shared contract helpers.
3. Update parity tests first, then move app callers to shared ownership where appropriate.
4. Run focused hosted execution tests, then required repo checks, then the mandatory simplify, coverage, and finish-review audit passes.

## Verification

- Focused while iterating:
  - `pnpm exec vitest run apps/web/test/hosted-execution-contract-parity.test.ts apps/web/test/hosted-execution-hydration.test.ts apps/web/test/hosted-execution-outbox.test.ts --no-coverage --maxWorkers 1`
- Required repo checks before handoff:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`

## Progress

- Done:
  - reviewed repo guardrails, architecture, verification docs, and the current hosted execution/outbox seam
  - mapped the live overlap with hosted onboarding receipt and hosted execution files already dirty in the worktree
- Now:
  - moving dispatch-ref contract ownership into `@murph/hosted-execution` with an app-local Prisma wrapper
- Next:
  - update focused tests and callers, verify the minimized payload shape, then run audits and repo checks
Completed: 2026-03-28
