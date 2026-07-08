# PR 456 ReviewGPT Round 4 Fixes

## Goal

Fix the accepted ReviewGPT round 4 findings on PR 456 so the current-production Vercel alias check is at the migration side-effect boundary and contract DDL cannot queue production locks for the workflow timeout.

## Constraints

- Revalidate current production in the same shell step that starts the migration command.
- Do not run repo-controlled migration code unless the alias still points at the deployment SHA.
- Add conservative transaction-local DB timeouts before executing contract SQL.
- Run focused tests and scoped verification before committing.

## Plan

1. Combine current-production verification and the migration command into one workflow step.
2. Add `SET LOCAL lock_timeout` and `statement_timeout` before each contract migration SQL body.
3. Update tests/docs.
4. Verify, commit, push, and rerun ReviewGPT.

## Verification

- Focused hosted web migration guard tests.
- `pnpm --dir apps/web typecheck`.
- `pnpm test:diff` on touched paths.
- ReviewGPT next round.

## State

Active. Implementation verified locally; ready to commit.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
