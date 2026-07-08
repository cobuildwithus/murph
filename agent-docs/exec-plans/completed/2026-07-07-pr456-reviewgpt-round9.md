# PR 456 ReviewGPT Round 9 Fix

## Goal

Bind the hosted web contract migration workflow to the production GitHub environment and document the rollback floor after destructive contract cleanup.

## Constraints

- Keep the workflow gated to Vercel production deployment statuses.
- Use the production GitHub environment for production secrets/vars.
- State the rollback floor before future contract migrations are added.

## Plan

1. Add `environment: production` to the contract migration workflow job.
2. Add workflow test coverage for the environment binding.
3. Document the rollback floor in hosted web migration docs and deploy map.
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
