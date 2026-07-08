# PR 456 ReviewGPT Round 1 Fixes

## Goal

Fix the accepted ReviewGPT round 1 findings on PR 456 so the post-deploy workflow cannot skip Vercel SHA-ref deployment events and the destructive Prisma guard protects the actual migration side-effect owner.

## Constraints

- Keep the migration architecture simple: predeploy expand-only Prisma, post-deploy contract cleanup.
- Do not expose database secrets outside the final contract migration step.
- Preserve the existing direct database URL validation.
- Run focused tests and scoped verification before committing.

## Plan

1. Move the destructive SQL scan from the production orchestration wrapper into `run-prisma-migrate-deploy.ts`.
2. Change the GitHub workflow to gate on production deployment status, then verify deployed SHA ancestry against `origin/main`.
3. Update tests and docs for those two fixes.
4. Run verification, commit, push, and rerun ReviewGPT.

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
