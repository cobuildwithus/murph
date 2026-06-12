# Hosted Usage Limit Notice PR Fixes

## Goal

Fix PR review findings for hosted AI usage limit notices without broadening the architecture:

- Do not send proactive limit notices for allowance periods that have already ended at accounting receipt time.
- Keep the transaction-compatible usage recording primitive database-only, and send Linq notices only from a wrapper/route path that owns the real client after commit.

## Constraints

- Web/Postgres remains the hosted AI usage ledger and allowance owner.
- Cloudflare/runtime continue to record usage through the signed web callback.
- No new queues, schedulers, persisted state, or compatibility shims.
- External Linq sends must not happen inside caller-owned transactions.

## Plan

1. Guard allowance crossing signals so stale historical periods account spend but do not emit a proactive notice.
2. Split usage recording from proactive notice delivery by returning crossing signals from the DB-only primitive and adding a non-transactional wrapper for the production route.
3. Update the route and focused hosted-web tests.
4. Run focused verification, required completion audits, then close this plan with the scoped commit.

## Verification

- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/hosted-execution-usage.test.ts test/hosted-execution-usage-allowance.test.ts test/hosted-execution-usage-route.test.ts` passed after the coverage-write regression: 3 files, 60 tests.
- `pnpm test:diff apps/web/src/lib/hosted-execution/usage.ts apps/web/src/lib/hosted-execution/usage-allowance.ts apps/web/app/api/internal/hosted-execution/usage/record/route.ts apps/web/test/hosted-execution-usage.test.ts apps/web/test/hosted-execution-usage-allowance.test.ts apps/web/test/hosted-execution-usage-route.test.ts` passed, including `apps/web verify`.
- `pnpm --dir apps/web typecheck` passed.
- `git diff --check` passed.
- `pnpm typecheck` failed in unrelated `packages/assistantd` and assistant-package module-resolution/type errors before this diff's owner-independent root typecheck could complete; the touched hosted-web typecheck passed separately.
Status: completed
Updated: 2026-06-11
Completed: 2026-06-11
