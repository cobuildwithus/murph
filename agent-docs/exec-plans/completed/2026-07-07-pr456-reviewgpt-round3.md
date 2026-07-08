# PR 456 ReviewGPT Round 3 Fixes

## Goal

Fix the accepted ReviewGPT round 3 findings on PR 456 so contract migrations only run when the Vercel production alias still points at the deployment SHA and the migration docs/guard do not steer new-shape requirements into post-deploy cleanup.

## Constraints

- Add the current-production fence immediately before SQL and before exposing the DB secret.
- Use official Vercel API primitives and fail closed when current production cannot be proven.
- Keep contract migrations scoped to final cleanup, not schema changes the new app requires.
- Run focused tests and scoped verification before committing.

## Plan

1. Add a final Vercel alias/current-production SHA fence to the GitHub workflow.
2. Block `ADD COLUMN ... NOT NULL` in the predeploy Prisma guard.
3. Update tests and docs to describe expand/backfill/switch/final-cleanup sequencing.
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
