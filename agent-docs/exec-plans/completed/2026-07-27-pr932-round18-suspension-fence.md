# PR 932 Round 18 Suspension Fence

Status: completed

## Goal

Make group-owner account deletion stabilize group-reply delivery authority
before any external teardown, so one approved deletion request completes across
both reply/deletion orderings without exposing a post-teardown retry.

## Finding

Round 18 found that the round-17 under-drain drift response could return a
retryable 503 only after the member was suspended and provider, billing, and
external browser cleanup had already begun. The settings client reloads after
that response, so the one-time approval and visible retry context are lost.

## Ownership and lock decisions

- Keep the existing member suspension as the deletion authority fence.
- In the suspension transaction, update every deletion member and then acquire
  the existing group-outreach drain advisory lock before commit.
- Group-aware reply delivery keeps its existing participant-member-before-drain
  lock order, then requires the selected group runtime member to remain
  unsuspended while it still owns the drain.
- A reply already holding the drain completes before suspension commits and is
  therefore present in the later deletion snapshot. A later reply observes the
  committed suspension and returns `target_unauthorized`.
- Remove the user-visible under-drain drift retry branch. With suspension and
  reply preparation serialized by the same drain, the participant set is
  stable before external teardown.
- Add no retry loop, state owner, queue, scheduler, marker attribution, or
  lifecycle machinery.

## Proof

- Unit-proof that suspension updates precede the drain fence and that a
  suspended group runtime rejects reply delivery.
- Replace the artificial drift-retry regression with stable-fence coverage.
- In real PostgreSQL, hold reply preparation's drain before suspension and
  prove deletion waits, the reply commits, and that same deletion request
  discovers the participant and completes.
- Prove the inverse ordering: deletion crosses the suspension fence first, a
  later reply returns `target_unauthorized`, and the same deletion request
  completes.
- In both orderings, prove external cleanup runs once, provider dispatch is
  correctly admitted or denied, group/correlation rows are removed, and the
  participant daily marker converges.
- Run focused store, account-deletion, transport, and PostgreSQL suites,
  canonical diff verification, and acceptance verification.

## Evidence

- ReviewGPT round 18 reviewed `b5b149ce5ebc` and returned one task-scoped
  review-induced recovery finding; exact-head CI otherwise passed all 27 checks.
- Focused PostgreSQL recovery proof passed all 5 tests, including both
  suspension-fence orderings with one deletion request and exactly-once
  external cleanup.
- Focused account deletion, group outreach store, and Linq transport suites
  passed all 134 tests.
- Web typecheck and targeted ESLint passed; ESLint retained one unrelated,
  pre-existing unused-argument warning in the group outreach store test.
- Canonical diff verification passed in Blacksmith Testbox
  `tbx_01kygte19q8cptszmcty6tt7ac` with 6,842 tests passed and 180 skipped.
- Canonical acceptance verification passed in Blacksmith Testbox
  `tbx_01kygtj16j9pdyccz6ws26pg94`, including the full web and Cloudflare
  verification lanes.

Updated: 2026-07-26
Completed: 2026-07-26
