# Stripe metadata normalization verification

Status: completed
Created: 2026-05-06
Updated: 2026-05-06

## Goal

- Verify and document hosted billing plan-upgrade metadata normalization for Stripe trial metadata keys.
- Success means the code or tests make explicit that empty-string metadata values are the Stripe API mechanism for unsetting existing keys, and the plan-upgrade repair path does not look like it will repeatedly repair already-normalized metadata.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-onboarding/billing-plan-change-service.ts`
  - `apps/web/test/hosted-onboarding-billing-plan-change-service.test.ts`
  - this execution plan
  - the shared coordination-ledger row for this lane
- Out of scope:
  - Changing hosted billing plan transition policy.
  - Changing Stripe webhook reconciliation semantics.
  - Changing the backfill route/service behavior unless direct evidence shows it is required.

## Constraints

- Preserve unrelated active ledger rows and working-tree edits.
- Do not expose local identifiers, secrets, raw Stripe payloads, or account/customer data in code, tests, logs, or handoff.
- Keep the change focused on metadata normalization proof.

## Risks and mitigations

1. Risk: The service depends on a subtle Stripe API convention for deleting individual metadata keys.
   Mitigation: Name that convention in a helper and cover it with a focused test.
2. Risk: A test could accidentally encode local mock behavior instead of the production contract.
   Mitigation: Keep the mock helper named around Stripe's documented unset behavior and assert the resulting returned metadata has absent trial keys.

## Tasks

1. Register the task in the coordination ledger. Done.
2. Inspect the current billing plan-upgrade metadata path. Done.
3. Add focused helper/test proof for unset trial metadata fields. Done.
4. Run required hosted-web verification. Done.
5. Run required completion audits. Done.
6. Close the plan through the repo commit path. Pending.

## Current state

- Production code now names the empty-string metadata deletion contract with `buildStripeMetadataUnsetFields`.
- The focused billing plan-upgrade test models Stripe's empty-string deletion behavior and asserts the reconciled subscription metadata owns no prior trial keys.

## Verification

- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/hosted-onboarding-billing-plan-change-service.test.ts --no-coverage` passed.
- `pnpm test:diff apps/web/src/lib/hosted-onboarding/billing-plan-change-service.ts apps/web/test/hosted-onboarding-billing-plan-change-service.test.ts` passed, including full `apps/web verify`.
- `security-privacy-review` audit completed with no findings.
- `coverage-write` audit made no edits and found coverage sufficient.
- `task-finish-review` audit completed with no findings.
Completed: 2026-05-06
