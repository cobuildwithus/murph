# Hosted Web Contract Migration Smoke

## Goal

Prove the hosted web post-deploy contract migration lane end to end with a no-op migration that exercises the GitHub/Vercel/production database wiring without changing product schema.

## Constraints

- Do not print or commit secrets or local `.env` contents.
- Keep the migration harmless and transaction-safe.
- Do not add a Prisma schema change or a normal predeploy Prisma migration for this smoke.
- Confirm no other contract migrations are queued before opening the PR.
- Merge only after PR CI is green and the ReviewGPT PR loop has zero accepted findings, unless the user explicitly changes that requirement.

## Plan

1. Confirm `origin/main` has no pending contract migration SQL files.
2. Add one timestamped no-op contract migration under `apps/web/prisma/contract-migrations`.
3. Add or adjust narrow tests only if existing coverage does not already exercise migration discovery/idempotency.
4. Run focused hosted-web migration tests, scoped diff verification, and privacy/diff checks.
5. Commit through `scripts/finish-task`, open the PR, run the ReviewGPT PR loop, merge, then monitor the production deployment and contract-migration workflow.

## Verification

- `pnpm --dir apps/web test:prepared production-migration-guard.test.ts`
- `bash scripts/workspace-verify.sh test:diff <touched paths>`
- `git diff --check`
- Post-merge: production Vercel deployment success for the merge SHA
- Post-merge: hosted web contract migration GitHub Actions workflow success for the same deployed SHA

## State

Ready to commit. Baseline inspection found only the contract-migrations README on `origin/main`; no queued contract migration SQL files. Added `20260708000000_contract_migration_smoke` as a no-op `SELECT 1;` contract migration. Focused migration guard, scoped `test:diff`, and `git diff --check` passed.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
