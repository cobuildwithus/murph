# Keep hosted Stripe Checkout light while monitoring tax

Status: completed
Created: 2026-04-15
Updated: 2026-04-15

## Goal

- Keep hosted signup Checkout light in live mode for now by removing automatic tax collection from API-created subscription sessions while preserving Stripe Tax monitoring in Dashboard configuration.

## Success criteria

- Hosted billing Checkout Sessions no longer send `automatic_tax` in live code.
- Hosted billing Checkout Sessions no longer send `customer_update.address`.
- The existing hosted onboarding billing-service tests assert the lighter live request shape.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-onboarding/billing-service.ts`
  - `apps/web/test/hosted-onboarding-billing-service.test.ts`
- Out of scope:
  - Dashboard Stripe Tax configuration
  - Product tax codes
  - Billing portal, webhook reconciliation, or metering changes

## Constraints

- Technical constraints:
  - Keep the change limited to the current hosted onboarding Checkout Session payload and direct tests.
  - Do not widen into billing status or Stripe webhook logic.
- Product/process constraints:
  - Billing-path repo change, so use the high-risk workflow with scoped verification.

## Risks and mitigations

1. Risk: Removing the fields could accidentally leave stale assertions or partial behavior in the hosted billing tests.
   Mitigation: Update the direct request-shape tests in the same patch and rerun the scoped `apps/web` verify lane.
2. Risk: Future tax collection enablement becomes less obvious.
   Mitigation: Keep the change narrow and document the “monitor now, collect later” decision in this plan and handoff.

## Tasks

1. Completed: registered the narrow hosted billing rollback lane.
2. Completed: removed `automatic_tax` and `customer_update.address` from the hosted Checkout Session request.
3. Completed: updated direct billing-service tests to match the lighter live Checkout config and explicitly assert the omitted request fields.
4. Completed: ran scoped verification and the required audit passes, then prepared the exact touched paths for commit.

## Decisions

- For now, use Stripe Tax monitoring through Dashboard configuration only and keep the live API-created hosted Checkout session free of automatic-tax collection fields until registrations require collection.
- Prove the lighter request shape directly at the mocked Stripe request boundary by asserting both the required metadata fields and the absence of `automatic_tax` / `customer_update`.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/billing-service.ts apps/web/test/hosted-onboarding-billing-service.test.ts`
- Expected outcomes:
  - Root typecheck passes.
  - Focused `apps/web` verification passes for the touched billing files.
- Outcomes:
  - Initial `pnpm typecheck` pass completed successfully before the coverage-write test update.
  - Initial `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/billing-service.ts apps/web/test/hosted-onboarding-billing-service.test.ts` passed before the coverage-write test update.
  - Required `coverage-write` audit added explicit negative assertions that the Checkout Session request omits `automatic_tax` and `customer_update`.
  - Post-coverage reruns of `pnpm typecheck` and the focused `test:diff` lane failed for unrelated pre-existing hosted channel-sync branch work in `apps/web/src/lib/hosted-onboarding/member-activation.ts`, `apps/web/test/hosted-onboarding-member-channel-sync.test.ts`, `apps/web/test/hosted-onboarding-stripe-revnet-reconciliation.test.ts`, `apps/web/test/settings-phone-sync-route.test.ts`, and `apps/web/test/settings-telegram-sync-route.test.ts`.
  - Required final review returned no findings in the billing scope and assessed the later verification failures as unrelated to this billing diff.
Completed: 2026-04-15
