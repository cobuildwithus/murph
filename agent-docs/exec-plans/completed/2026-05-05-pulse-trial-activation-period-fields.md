# Pulse Trial Activation Period Fields

## Goal

Fix local hosted onboarding activation when Stripe returns a valid Pulse Trial subscription with `trial_start`/`trial_end` but without current-period fields.

## Constraints

- Preserve hosted billing monotonicity and trial redemption guardrails.
- Do not widen Stripe ownership matching or activate ambiguous sessions.
- Keep output/logging redacted; do not persist raw Stripe payloads.
- Preserve unrelated dirty worktree edits.

## Plan

1. Confirm the stuck local state from DB and source path.
2. Relax only the Pulse Trial checkout activation period-field gate.
3. Add regression coverage for missing current-period fields.
4. Run focused verification and required completion audits.
5. Close this active plan or report any safe-commit blocker.

## Verification

- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/hosted-onboarding-stripe-checkout-completed.test.ts --no-coverage` passed.
- `pnpm --dir apps/web lint` passed.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm typecheck` reached and passed `apps/web` typecheck, then failed in unrelated dirty `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts` edits.
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/stripe-billing-events.ts apps/web/test/hosted-onboarding-stripe-checkout-completed.test.ts` completed dependency guards, app lint, and Next build, then failed on unrelated `apps/web/test/hosted-phone-auth.test.ts` assertions expecting `h-16` while the dirty tree renders `h-14`.

## Outcome

- Pulse Trial checkout activation now treats `trial_start` and `trial_end` as the activation entitlement bounds.
- Stripe subscription current-period fields are persisted only when present and internally consistent with the trial window; otherwise they are cleared to `null` without blocking activation.
- Checkout activation now requires both checkout-session and subscription customer ids to be present and equal.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
