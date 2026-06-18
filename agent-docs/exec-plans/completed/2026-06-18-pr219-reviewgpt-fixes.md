# PR 219 ReviewGPT Fixes

## Goal

Fix the ReviewGPT findings on PR 219 before merge:

- keep the Stripe subscription update idempotent request parameters compatible while preserving recovery for cached failed updates;
- make the no-payment-method Start Pulse flow continue on return from Stripe instead of dropping users on Home;
- collapse hosted AI allowance spend back to the usage ledger as the only spend authority.

## Constraints

- Work in the PR 219 worktree and branch only.
- Preserve existing Stripe/webhook reconciliation ownership and avoid adding a new subscription or state machine.
- Avoid a schema migration; existing persisted columns may remain but should not be treated as spend authority.
- Keep changes narrow, simple, and covered by focused tests plus required verification.

## Working Set

- `apps/web/src/lib/hosted-onboarding/billing-start-paid-pulse-service.ts`
- `apps/web/src/components/settings/hosted-start-paid-pulse-button.tsx`
- `apps/web/src/components/settings/hosted-billing-settings-action.tsx`
- `apps/web/src/lib/hosted-execution/usage-allowance.ts`
- focused hosted billing and hosted execution allowance tests

## Plan

1. Split Stripe retrieve/update expansion usage and add guarded idempotency-key recovery.
2. Add a dedicated payment-method return/finish path for Start Pulse.
3. Remove allowance-period spend repair/carryover authority and read spend from counted usage rows by `occurredAt`.
4. Update focused tests.
5. Run verification, required audits, commit, push, then rerun ReviewGPT until clean.

## Outcome

- Split Stripe subscription retrieve/update expansions so idempotent updates keep the legacy parameter shape.
- Added guarded versioned retry only after a fresh valid trialing subscription retrieval confirms no conversion invoice.
- Added a dedicated Start Pulse payment-method return surface, explicit finish action, and paused auto-trial resume handling.
- Kept Start Pulse UI entry points on-screen for `billing_pending` with explicit retry/status instead of treating it as success.
- Made `HostedAiUsage` the spend authority for allowance decisions and account export summaries.
- Stopped writing new derived allowance period labels on usage rows.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-linq-usage-reset-e2e.test.ts apps/web/test/hosted-execution-usage-allowance.test.ts apps/web/test/hosted-onboarding-billing-start-paid-pulse-service.test.ts apps/web/test/hosted-billing-settings.test.tsx apps/web/test/settings-billing-start-paid-pulse-route.test.ts apps/web/test/hosted-onboarding-billing-plans.test.ts apps/web/test/settings-page.test.ts apps/web/test/hosted-account-data-service.test.ts`
- `pnpm -C apps/web typecheck:prepared`
- `pnpm test:diff -- <changed apps/web files and tests>`
- Local review subagents found frontend, coverage, privacy, and simplification gaps; addressed all actionable findings. A final retry-only subagent pass disconnected before completion after verification passed.
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
