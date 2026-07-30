# PR 1041 ReviewGPT round 18 crypto boundary correction

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Keep direct Pulse Checkout activation authority false until a Checkout
  candidate wins its member transaction.
- Reuse the existing request-scoped domain-root cache when activation projects
  encrypted member fields, so no KMS request runs while the member transaction
  and row lock are held.
- Stay inside the round-17 retrospective decision: existing billing, member,
  and crypto-root owners only, with no new durable state, service, queue, or
  lifecycle.

## Round 18 findings

- The preflight durably provisioned all four crypto roots before Checkout
  acceptance. Complete root presence is also durable activation proof, so a
  later pre-lock failure could leave an inactive member authorized as active.
- The scalar control/ingress prewarm populated the scoped cache, but the batch
  root-key unwrap used by real private-field projection bypassed that cache and
  called KMS directly inside first activation.

## Overlap audit

- No other open PR changes the domain-root store, the direct Stripe activation
  preflight, or its production crypto regression test.
- Open PR 1130 still overlaps only the generic billing store for Group-plan
  scheduling and eligibility behavior. This correction does not change that
  policy surface.
- Other path overlaps are shared reliability, schema, design-catalog, or
  migration-fixture files rather than duplicate crypto or Pulse activation
  implementations.

## Decision

- Persist and warm only control and ingress before the member lock. Prepare
  device and runtime candidates outside the lock, then pass them into the
  existing winner activation so the complete root set becomes durable only in
  the accepted transaction.
- Keep the batch metadata read and envelope verification intact, but route each
  verified concrete root key through the existing scoped cache helper. The
  scalar prewarm already aliases active roots to those concrete cache keys.
- Test the production private-field batch projection with real encrypted Privy
  identity data, assert activation proof stays false after a failed preflight,
  and retain existing first/repeated/loser Checkout coverage.

## Success criteria

- A fresh inactive member has only control and ingress roots after preflight,
  and complete-root activation proof remains false until winner commit.
- A pre-lock KMS failure leaves activation proof false.
- The real encrypted identity batch projection runs after the simulated member
  lock with zero additional KMS decrypts.
- First winner, repeat, loser, superseded, participant projection, and group
  phone-call denial behavior remain covered.
- Focused tests, Hosted Web typecheck, canonical verification, exact-head CI,
  and a later ReviewGPT `ROUND_OUTCOME: PASS` succeed.

## Plan

1. [x] Split durable preflight roots from winner-transaction candidates.
2. [x] Reuse the concrete-key scoped cache in the batch unwrap path.
3. [x] Add production-faithful crypto, activation-proof, and affected-surface
   regressions and update the reliability contract.
4. [x] Run focused and canonical verification and prepare the scoped commit.
   Continue exact-head CI plus ReviewGPT after the pushed correction.

## Progress

- Round 18 completed against exact head
  `0428a11a35bf9e92a179ccccaaa0ce2fbdcc4c28`.
- The live open-PR audit found no duplicate implementation of either
  correction.
- Preflight now commits only control and ingress, warms both, and returns
  device/runtime candidates to the existing activation transaction.
- The batch private-field unwrap verifies the database envelope first and then
  resolves the concrete root through the existing scoped cache.
- The production crypto fixture executes the real first-activation function
  with an encrypted Privy identity. It records two pre-lock KMS decrypts, zero
  additional decrypts during activation, a materialized activation wake, false
  activation proof before winner commit, and true proof afterward.
- A failed preflight retains only control and ingress and leaves activation
  proof false. Existing participant projection, skip-if-activated, and group
  phone-call denial suites remain green.

## Verification

- Production crypto fixture: 27 tests passed.
- Browser, webhook, winner/repeat/loser, and phone-call suites: 150 tests
  passed.
- Activation-proof and participant affected-surface suites: 46 tests passed.
- Hosted Web prepared typecheck, touched-file ESLint, and `git diff --check`
  passed.
- Canonical `pnpm test:diff` passed every repository guard and reached Hosted
  Web verification. Both it and `pnpm verify:acceptance` then queued behind the
  same pre-existing shared-host acceptance owner from another checkout, so only
  this task's queued processes were stopped. Exact-head CI owns the remaining
  broad clean-host proof.
Completed: 2026-07-29
