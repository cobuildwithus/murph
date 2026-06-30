# PR 310 Linq Provider Event Order

## Goal

Fix ReviewGPT round 42's accepted finding: Linq provider-event receipt/status
projections must use a total provider-event order instead of duplicated
timestamp-only comparators.

## Scope

- `apps/web/src/lib/hosted-onboarding/linq-line-store.ts`
- `apps/web/src/lib/hosted-onboarding/linq-delivery-store.ts`
- focused hosted Linq observability tests

## Constraints

- Do not add a new route, manager, queue, lifecycle, or persisted state owner.
- Reuse existing provider-event ids plus existing line/delivery watermark
  columns.
- Preserve onboarding, reply delivery, delivery receipt ingestion, alerting,
  and line-health projections.

## Verification Plan

- Focused hosted Linq observability tests.
- `pnpm typecheck`.
- Truthful `pnpm test:diff` over changed files.
- Local hosted onboarding/iMessage E2E when the worktree stack is running.
Status: completed
Updated: 2026-06-29
Completed: 2026-06-29
