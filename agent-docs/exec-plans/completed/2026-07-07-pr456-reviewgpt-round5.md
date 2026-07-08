# PR 456 ReviewGPT Round 5 Follow-Up

## Goal

Prove the hosted web contract migration workflow does not point `actions/setup-node` at a missing Node version file.

## Constraints

- Keep the production workflow behavior unchanged unless the source is actually broken.
- Add the smallest regression coverage needed for the ReviewGPT finding.
- Re-run focused tests and scoped verification before committing.

## Plan

1. Add a workflow assertion that every `node-version-file` reference resolves to a file in the repo checkout.
2. Verify the focused hosted web migration guard tests.
3. Commit, push, and rerun ReviewGPT.

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
