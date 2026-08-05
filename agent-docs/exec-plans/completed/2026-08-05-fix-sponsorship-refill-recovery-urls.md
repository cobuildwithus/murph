# fix-sponsorship-refill-recovery-urls

Status: completed
Created: 2026-08-05
Updated: 2026-08-05

## Goal

- Make automatic group-sponsorship refill recovery open the correct Stripe Checkout for the exact refill purchase, without weakening purchase-target validation or introducing a second recovery owner.

## Success criteria

- Newly created refill purchases persist success and cancel URLs bound to their own purchase id.
- Existing malformed refill rows are repaired on the payer's first recovery attempt while still under the existing locks and write fence.
- Recovery continues through the existing Stripe Checkout path and remains idempotent.
- Focused unit/integration tests reproduce the production failure and prove recovery succeeds.
- Required ReviewGPT and exact-head CI gates pass before deployment.

## Scope

- In scope: refill return-URL construction, regression coverage, bounded owner-path repair for affected production rows, PR review, deploy, and post-deploy verification.
- Out of scope: redesigning sponsorship billing, changing sponsorship caps, changing Stripe prices, or weakening target/authority validation.

## Constraints

- Technical constraints: retain the persisted purchase as the work identity; reuse canonical activation return targets; keep Checkout as the payment UI; preserve lock ordering and idempotency.
- Product/process constraints: no private production identifiers in code, tests, plans, commits, or PR artifacts; use the isolated worktree/PR lane and required billing review gates.

## Risks and mitigations

1. Risk: rewriting an arbitrary return URL could redirect outside the authorized group target.
   Mitigation: accept only the already-validated activation URL shape, update only the purchase-id query parameter, and re-run the canonical target parser in tests.
2. Risk: fixing only new rows leaves the current refill unrecoverable.
   Mitigation: repair only an untouched `created` refill or the exact `payment_failed` refill during its existing fenced recovery transition.
3. Risk: broad retry changes could double-charge.
   Mitigation: do not change dispatch, payment idempotency, purchase identity, or recovery ownership.

## Tasks

1. Confirm the current return-URL builders, target parser, and refill creation ownership on the latest main.
2. Add a narrow helper that rebinds canonical purchase return URLs to a refill purchase id.
3. Use it at refill creation and add focused regression coverage for success and cancel URLs plus recovery projection.
4. Add and verify a bounded repair path for existing mismatched nonterminal refill rows.
5. Run focused checks, inspect the diff, commit, push, and open the PR.
6. Run preliminary specialist and final ReviewGPT gates concurrently with exact-head CI; resolve all findings.
7. Merge/deploy, exercise the payer recovery action, and verify the affected flow and production logs.

## Decisions

- Keep strict `purchase_target_invalid` validation; the persisted producer is wrong, not the validator.
- Reuse Stripe Checkout for recovery rather than adding a custom payment form or direct PaymentIntent recovery UI.
- Normalize a pre-fix refill only while it is still `created` or during the existing `payment_failed` → `created` payer-recovery transition, under the existing payer/beneficiary locks and reconciliation write fence. Do not touch a Checkout or payment already in progress.
- Accepted the preliminary specialist finding that the original patch required two recovery clicks for a `payment_failed` row. Rebinding both URLs inside the existing reset transition closes that gap without another state owner or write.

## Verification

- Commands to run: focused Vitest suites for sponsorship authorization, purchase status/service, and any repair utility; TypeScript checks selected by the testing map; exact-head GitHub Actions; ReviewGPT specialist and final gates.
- Expected outcomes: a reproduced mismatch fails before the fix, refill URLs contain the refill id after the fix, recovery produces a Stripe Checkout capability, no unrelated subscription or usage-credit behavior changes, and production has zero malformed nonterminal refill rows after repair.
- Reproduction: the focused sponsorship authorization test failed before the source change because the refill success URL retained the activation purchase id.
- Local proof: 185 focused tests pass across sponsorship authorization, signed group-target projection, and usage-credit purchase service, including first-attempt recovery through Stripe Checkout; the prepared web typecheck passes; scoped ESLint has zero errors.
- Preliminary specialist review found the first-attempt `payment_failed` gap; the accepted fix and integration proof are included in the final head.
- Final ReviewGPT round 1 passed with no qualifying code findings, and all exact-head GitHub Actions passed.

## Outcome

- New refills bind canonical success and cancel URLs to their deterministic purchase id at creation.
- Pre-fix `created` rows self-heal under the existing fence, and pre-fix `payment_failed` rows self-heal inside the existing payer-recovery transition before target validation or Stripe I/O.
- No schema, migration, endpoint, queue, dependency, alternate payment flow, or second state owner was added.
- Direct production proof remains an authenticated **Review payment** click after deployment; the resulting state and logs are verified operationally without persisting private identifiers.
Completed: 2026-08-05
