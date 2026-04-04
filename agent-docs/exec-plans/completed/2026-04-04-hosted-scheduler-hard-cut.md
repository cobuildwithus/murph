# Hosted Scheduler Hard Cut

## Goal

Remove the remaining hosted scheduler fallback so greenfield hosted cron routes require explicit scheduler tokens only.

## Scope

- Remove the `CRON_SECRET` fallback from hosted scheduler auth in `apps/web`.
- Remove the checked-in Vercel cron config that depended on that fallback.
- Update tests and docs to the explicit scheduler-token contract.

## Constraints

- Keep the change coherent: do not leave behind docs or config that imply native Vercel cron still works.
- Keep scope to the hosted scheduler seam only.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

- Completed
Status: completed
Updated: 2026-04-04

## Outcomes

- Removed the remaining `CRON_SECRET` fallback from hosted scheduler auth so the internal cron routes now require `HOSTED_EXECUTION_SCHEDULER_TOKENS` only.
- Deleted the checked-in `apps/web/vercel.json` scheduler config and its test so the repo no longer advertises a native Vercel cron path that depends on removed fallback behavior.
- Updated hosted-web docs and scheduler-related tests to the greenfield external-scheduler contract.

## Verification Notes

- `pnpm typecheck`: passed.
- `pnpm test`: failed in unrelated dirty-tree hosted-onboarding work with `apps/web/test/hosted-onboarding-webhook-idempotency.test.ts(113,3): error TS2305` because `@/src/lib/hosted-onboarding/linq` has no exported member `buildHostedGetStartedReply`.
- Focused verification passed for the touched scheduler surfaces:
  - `pnpm exec vitest run apps/web/test/hosted-execution-routes.test.ts --config apps/web/vitest.config.ts --no-coverage`
  - `pnpm --dir packages/hosted-execution exec vitest run test/hosted-execution.test.ts --no-coverage`
- `git diff --check`: passed.
- `pnpm test:coverage`: reported `83` test files passed and `1369` tests passed, then exited `1` because the same unrelated hosted-onboarding symbol mismatch broke `apps/web` verification.
Completed: 2026-04-04
