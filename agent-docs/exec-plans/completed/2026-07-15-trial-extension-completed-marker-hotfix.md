# Trial extension completed-marker hotfix

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Prevent a completed Pulse Trial extension marker from being interpreted as a
  pending recovery after the member has moved into paid billing.

## Success criteria

- The pending target marker remains present through paused prepare and resume
  recovery, but is cleared by the final update that proves `trialing` at the
  target end.
- Final-update response loss and local-write failure remain recoverable from
  the provider trial end plus completed operation/day markers.
- A completed extension followed by an active paid conversion is ineligible for
  a fresh trial extension even if local paid invoice reconciliation is delayed.
- Paid conversion clears any legacy pending target marker in the same Stripe
  mutation that ends the trial.
- The known successfully extended production subscriptions have their legacy
  target marker cleared without changing billing status or trial end.
- No paid subscription is moved back to trialing by the ops recovery path.

## Scope

- In scope: the Pulse Trial extension provider metadata transition, clearing the
  marker during paid conversion, bounded cleanup of the known successful
  production cohort, and focused regressions across recovery and conversion.
- Out of scope: changing trial duration, invoice policy, plan selection, Stripe
  subscription structure, or database schema.

## Constraints

- Preserve the current paused prepare/resume recovery protocol and exact-target
  idempotency.
- Preserve successful final-update and local-write recovery without a new state
  owner, provider read, queue, or persisted field.
- Keep provider and member identifiers out of logs and committed examples.

## Risks and mitigations

1. Risk: clearing the target marker breaks ambiguous-success recovery.
   Mitigation: retain operation/day markers and recover completed `trialing`
   state from the exact provider `trial_end`, which the existing resolver
   already supports.
2. Risk: clearing the marker too early breaks paused or active intermediate
   recovery.
   Mitigation: keep the target only on prepare/resume state and clear it only in
   the final update that sets the exact trial end.
3. Risk: a paid transition is still eligible through another predicate.
   Mitigation: add a focused active-provider regression with local trial state
   and completed markers, and prove no provider mutation occurs.

## Tasks

1. Add a failing regression that distinguishes pending active recovery from a
   completed active paid conversion.
2. Make the final provider update clear the pending target marker while keeping
   operation/day markers.
3. Update recovery assertions for final response loss and local write loss.
4. Clear legacy target metadata during paid conversion and reject already-local
   completed targets as active recovery.
5. Run focused and routed verification, required coverage and billing-state
   audits, then ship a reviewed follow-up PR and verify deployment.
6. Clear the target marker on the known successful production cohort after
   canonical Stripe identity/state rechecks; do not mutate `trial_end`.

## Decisions

- The target marker is a pending predicate, not historical completion metadata.
- Operation and extension-day markers remain as completion identity, while the
  canonical provider `trial_end` is sufficient for completed-state recovery.
- The state audit proved already-persisted targets from the deployed run need a
  bounded provider cleanup; future paid conversion also clears the marker.

## Verification

- Focused billing and route suites: 78 tests passed.
- Routed `pnpm test:diff`: 5,123 tests passed, 139 skipped; typecheck,
  lint, production build, dev smoke, and workspace guards passed.
- Coverage-write review: no unresolved material coverage gap.
- State-inconsistency audit: no remaining Critical, High, or Medium finding.
- `git diff --check` and identifier/privacy scan passed.

## Post-deploy action

- After the reviewed deployment is Ready, clear only
  `murphTrialExtensionTargetTrialEnd` on the known successful production
  extension cohort after canonical member/subscription/operation rechecks.
  Preserve operation/day metadata, billing status, and `trial_end`, then verify
  that no matching subscription retains the target marker.
Completed: 2026-07-15
