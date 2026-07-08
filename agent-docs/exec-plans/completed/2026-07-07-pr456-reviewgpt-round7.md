# PR 456 ReviewGPT Round 7 Fix

## Goal

Fix the remaining hosted web contract migration workflow races so stale deployment events cannot cancel valid work and destructive cleanup waits for a bounded production drain before SQL.

## Constraints

- Do not let unvalidated stale deployment events cancel a current deployment run.
- Add a drain wait before the final current-production alias check.
- Keep Node setup source visible in the workflow/audit package.
- Verify the workflow contract through focused tests and scoped apps/web verification.

## Plan

1. Set contract migration workflow cancellation to false.
2. Add a configurable drain wait before the final Vercel alias SHA check.
3. Use explicit workflow Node version and update tests/docs.
4. Verify, commit, push, and rerun ReviewGPT.

## Verification

- `pnpm --dir apps/web test:prepared production-migration-guard.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm test:diff` on touched paths
- ReviewGPT next round

## State

Active. Implementation verified locally; ready to commit.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
