# Remove dormant Stripe meter drain

Status: completed
Created: 2026-05-10
Updated: 2026-05-10

## Goal

- Remove the dormant Stripe hosted AI usage meter drain and checkout usage-price plumbing while preserving the hosted AI usage ledger used for allowances, audit, and future rebuilds.

## Success criteria

- No runtime, cron, config, docs, or tests reference the `stripe_meter` hosted AI usage billing mode or usage-meter price setup.
- Hosted AI usage recording remains intact for ledger/allowance/audit purposes and continues to mark usage as non-exported to Stripe.
- Billing checkout/subscription code creates only the configured recurring hosted plan line item.
- Focused tests/typechecks and required completion audits run, or blockers are reported with evidence.

## Scope

- In scope:
  - Stripe meter drain route, implementation, tests, cron config, env/docs.
  - Hosted onboarding billing config that conditionally added Stripe metered usage prices.
  - Dev-hosted local Stripe env validation for removed usage-price variables.
- Out of scope:
  - Database column/migration removal for historical `stripe_meter_*` usage fields.
  - New usage-based billing design or Stripe meter replacement.
  - Unrelated hosted device-connect and Cloudflare runner worktree changes.

## Constraints

- Technical constraints:
  - Preserve hosted AI usage rows for allowance and audit decisions.
  - Do not make web and Cloudflare deploy order brittle.
  - Keep public workspace imports through declared package entrypoints.
- Product/process constraints:
  - This is a cleanup/removal pass, not a billing product redesign.
  - Preserve unrelated dirty worktree edits.

## Risks and mitigations

1. Risk: Removing checkout usage-price logic could break existing subscription reconciliation that sees legacy metered items.
   Mitigation: Preserve tolerant event/read paths for existing Stripe objects where possible while stopping new usage-price configuration.
2. Risk: Removing usage drain code could accidentally remove internal usage accounting.
   Mitigation: Keep usage recording and allowance tests focused on ledger behavior.

## Tasks

1. Trace current Stripe meter billing references and classify each as drain, checkout config, ledger, or historical compatibility.
2. Remove drain route/implementation/cron/env/docs and update usage recording defaults.
3. Remove checkout metered usage price config and update hosted onboarding billing tests.
4. Update dev-hosted local Stripe config validation and package exports/tests.
5. Run focused verification, coverage audit, security/privacy audit, and task-finish audit.
6. Finish with a scoped commit if unrelated dirty work does not block staging.

## Decisions

- Keep DB columns and serialized usage fields for historical data compatibility; remove active Stripe export path only.
- Change the active Prisma default and transition existing pending/processing Murph usage rows to `skipped` so removed drain state cannot be mistaken for billable backlog.
- Delete only marked legacy hosted AI usage metered Stripe items during hosted plan transitions; reject unmarked or quantity-bearing metered items instead of silently deleting possible add-ons.
- Future usage-based billing should be rebuilt intentionally from the usage ledger rather than preserving this dormant `stripe_meter` abstraction.

## Verification

- Passed:
  - `pnpm --dir apps/web exec tsc --noEmit --pretty false --incremental false --project tsconfig.json`
  - `pnpm --dir apps/web lint` (warnings only in unrelated dirty `apps/web/src/lib/device-sync/agent-session-service.ts`)
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-execution-usage.test.ts apps/web/test/hosted-execution-usage-allowance.test.ts apps/web/test/hosted-execution-usage-gate-notice.test.ts apps/web/test/dashboard-home-page.test.tsx apps/web/test/hosted-onboarding-billing-plans.test.ts apps/web/test/hosted-onboarding-env.test.ts apps/web/test/hosted-onboarding-runtime.test.ts apps/web/test/hosted-onboarding-billing-service.test.ts apps/web/test/hosted-onboarding-billing-plan-change-service.test.ts apps/web/test/hosted-onboarding-billing-plan-switch-to-pulse-service.test.ts apps/web/test/hosted-onboarding-billing-start-paid-pulse-service.test.ts apps/web/test/hosted-onboarding-stripe-billing-events.test.ts apps/web/test/hosted-onboarding-csrf.test.ts apps/web/test/hosted-onboarding-privy-invite-status.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`
  - `pnpm --filter @murphai/hosted-execution typecheck && pnpm --filter @murphai/hosted-execution test -- hosted-execution.test.ts`
  - `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/dev-hosted-local/stripe.test.ts scripts/dev-hosted-local/stack.test.ts`
  - `git diff --check`
- Blocked / unrelated:
  - `bash scripts/workspace-verify.sh test:diff <task paths>` is blocked in repo TS tools typecheck by unrelated dirty `packages/core/src/operations/write-batch.ts`.
  - Including `apps/web/test/hosted-onboarding-linq-dispatch.test.ts` in the focused app suite fails on unrelated dirty one-shot notice claim behavior.
- Audits:
  - Coverage-write pass found the start-paid Pulse legacy metered item gap; fixed and retested.
  - Security/privacy pass found pending usage-row and broad metered-item deletion gaps; fixed and retested.
Completed: 2026-05-10
