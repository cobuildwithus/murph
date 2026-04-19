## Title

Refresh hosted onboarding launch pricing copy and plan constants for the new $8 monthly / $80 annual offer.

## Goal

Update the shared hosted onboarding billing plan definitions so every homepage/onboarding surface shows the new launch pricing and annual badge copy, with focused proof that the rendered summaries stay aligned with the shared constants.

## Scope

- `apps/web/src/lib/hosted-onboarding/billing-plans.ts`
- focused hosted onboarding billing-plan proof in `apps/web/test/**`

## Constraints

- Keep the change limited to shared pricing definitions and direct proof.
- Preserve existing Stripe price-id env key wiring; this lane is about repo-local display and plan metadata only.
- Avoid unrelated onboarding flow, checkout, or homepage layout changes.

## Verification

- `pnpm --dir apps/web test -- apps/web/test/hosted-onboarding-billing-plans.test.ts`
- `pnpm --dir apps/web typecheck`

## Notes

- Annual positioning should read `2 months free` rather than a dollar-savings badge.
- The shared plan definitions drive homepage summaries and the hosted onboarding plan picker, so this single source must stay covered by tests.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
