# PR 1041 ReviewGPT round 16 Pulse revalidation

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Prevent an old first-time Pulse Checkout from replacing a later redeemed
  billing identity while keeping Stripe and encryption preparation outside the
  member transaction.

## Success criteria

- Pulse completion resolves identity from trusted Session metadata, then locks
  and reads the authoritative member billing snapshot before classifying the
  candidate.
- A redeemed or otherwise ineligible member keeps the current billing identity
  and returns the completed candidate subscription for post-commit cleanup.
- An unredeemed incomplete identity with the matching durable attempt can still
  be replaced.
- Any unexpected policy rejection after Checkout acceptance aborts the
  transaction instead of committing the identity replacement.
- Focused proof, Web typecheck, exact-head CI, and the final ReviewGPT loop pass.

## Scope

- In scope: Pulse Checkout completion ordering, focused regression coverage,
  and the matching reliability contract.
- Out of scope: new billing state, queues, services, lifecycle machinery,
  schema changes, provider behavior, and unrelated PR cleanup.

## Plan

1. Add regression proof for a core-only direct lookup followed by a redeemed
   authoritative billing snapshot.
2. Acquire the existing member lock and reread the full billing snapshot before
   Pulse candidate classification and Checkout acceptance.
3. Abort on an unexpected policy rejection after acceptance.
4. Verify the loser and stale-incomplete winner paths plus transaction ordering.
5. Run focused tests, Web typecheck, finish the scoped plan, push, and continue
   exact-head CI plus ReviewGPT until both pass.

## Decisions

- Accept ReviewGPT round 16's race finding.
- Reuse the existing member row lock, billing snapshot, loser classifier, and
  post-commit cleanup outcome.
- Keep provider reads and prepared encrypted billing identifiers outside the
  transaction; add no new state owner or asynchronous machinery.

## Verification

- The focused Checkout completion, lookup, browser reconciliation, and webhook
  reconciliation suites pass: 144 tests.
- The expanded billing, auto-trial, durable-attempt, completion, lookup, and
  webhook suite passes: 293 tests.
- Hosted Web typecheck and `git diff --check` pass.
- Canonical local diff verification passed before the final explicit-select
  tightening: 568 files passed, 16 skipped; 7,483 tests passed, 226 skipped;
  Web typecheck, lint, development smoke, and the Next production build passed.
- After the explicit-select tightening, the exact lookup suite passed 11 tests
  and Hosted Web typecheck passed.
- A fresh one-shot Blacksmith Testbox passed the exact frozen candidate
  (`03d8aa7e682e55ac6469ed159b5fe15a122fd32c`) through
  `pnpm verify:acceptance`: full workspace and package coverage, typechecks,
  lint, development smoke, the Next production build, and Cloudflare
  verification. The 16-CPU default-profile run completed successfully in
  5m54s (Testbox `tbx_01kyr2p8ta8vj3kdk9mtn1xy4s`, Actions run
  `30499045826`).
- A second local canonical admission attempt was abandoned only after the
  repository workspace lock reached its 30-minute infrastructure timeout; it
  did not report a code or test failure.
- All open PR changed-path sets and live worktree branches were checked before
  publication. No other open PR changes this remediation's Checkout completion
  or reconciliation source/tests. The adjacent open Group-plan PR changes plan
  selection and scheduling only; the older broad Stripe PR is closed, and the
  historical Group-plan branch is already merged.

## Progress

- Reproduced the stale core-only lookup path and confirmed that Checkout
  acceptance can currently mutate identity before the durable redemption guard
  runs.
- Replaced the stale projection with one locked, select-only billing decision
  read over status, phase, redemption, and the deterministic subscription
  lookup key.
- Kept Stripe retrieval and encrypted identifier preparation before the lock,
  retained the unwrap cache through browser and webhook Checkout transactions,
  and made a post-accept policy rejection abort the transaction.
- Added regressions for the direct-metadata lookup seam, redeemed loser,
  stale-incomplete winner, post-accept rollback, select-only decision read, and
  browser/webhook cache scope.
Completed: 2026-07-29
Completed: 2026-07-29
