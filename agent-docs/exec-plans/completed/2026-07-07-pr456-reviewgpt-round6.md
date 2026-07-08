# PR 456 ReviewGPT Round 6 Fix

## Goal

Prevent newly introduced backdated Prisma migrations from bypassing the hosted web predeploy destructive-SQL guard.

## Constraints

- Keep the already-applied historical Prisma migrations exempt.
- Scan every non-exempt migration directory regardless of lexical timestamp order.
- Add a focused regression proving a backdated destructive migration blocks before `prisma migrate deploy`.

## Plan

1. Replace lexical baseline skipping with a frozen historical migration ID exemption set.
2. Add the backdated destructive migration regression test.
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
