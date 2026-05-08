# DeepSec High Bug Fixes

## Goal

Land the seven verified DeepSec `HIGH_BUG` fixes with small owner-local changes:

- make hosted email ingress use the real Cloudflare Email message shape plus an explicit trusted sender-verification adapter
- run hosted account database deletion before idempotent Cloudflare cleanup
- classify Stripe dispute outcomes before suspending or reinstating billing access
- serialize automation registry read-resolve-write in core
- validate write-operation ids before staged attachment cleanup deletes operation directories
- align scheduled-log persistence with the executable assistant cron schedule contract

## Scope

- `apps/cloudflare/src/hosted-email/**`
- `apps/cloudflare/src/hosted-email.ts`
- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/test/hosted-email*`
- `apps/web/src/lib/hosted-privacy/account-data-service.ts`
- `apps/web/test/hosted-account-data-service.test.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-*.ts`
- `apps/web/test/hosted-onboarding-stripe-*`
- `packages/contracts/src/{automation,schedule-intent,scheduled-log}.ts`
- `packages/core/src/{automation,event-attachments,scheduled-logs}.ts`
- `packages/core/test/*`
- `packages/assistant-engine/src/assistant/cron/**`
- focused tests for changed owners

## Constraints

- Keep fixes simple, durable, and owner-local.
- Preserve unrelated dirty worktree changes and the existing DeepSec HIGH plan.
- Do not introduce broad new state machines unless a narrower owner seam cannot preserve correctness.
- Do not log raw email, billing, account, or vault data.

## Verification

- Run focused tests for hosted email, account deletion, Stripe dispute reconciliation, core automation/attachments/scheduled logs, and assistant cron schedule projection.
- Run `pnpm typecheck`.
- Run `pnpm test:diff` scoped to the touched task files when implementation is stable, or report any unrelated blocker.
- Run required security/privacy, coverage, and final-review audits before commit.

## State

- Implemented the seven owner-local fixes and focused regression tests.
- Focused core, Cloudflare hosted email, hosted account deletion, Stripe dispute, assistant cron scheduled-log, contracts build, core build, Cloudflare typecheck, and assistant-engine typecheck checks passed.
- Root `pnpm typecheck` and scoped `test:diff` are blocked by unrelated active device-syncd webhook trace test typing errors in dirty files outside this plan scope.
- Hosted web package typecheck is blocked by the same unrelated webhook trace test typing errors plus unrelated in-flight WhatsApp package export wiring.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
