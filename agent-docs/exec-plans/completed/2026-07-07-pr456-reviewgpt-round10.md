# PR 456 ReviewGPT Round 10 Fix

## Goal

Prevent duplicate hosted web contract migration runs from waiting past their current-production proof before applying destructive SQL.

## Constraints

- Keep the final Vercel alias proof in the workflow.
- Do not add a scheduler or lifecycle state.
- Fail closed on advisory-lock contention and rely on a later deployment or manual rerun.

## Plan

1. Change the contract migration advisory lock acquisition to non-blocking.
2. Add a focused lock-contention regression test.
3. Verify, commit, push, and rerun ReviewGPT.

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
