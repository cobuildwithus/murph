# Pulse Trial cohort through July 13

## Goal

Expand the fixed July 2026 Pulse Trial recovery campaign from trials started or
redeemed before July 10 to trials started or redeemed before July 14, so the
additional cohort can receive the existing one-time seven-day extension.

Success criteria:

- Include provider and finalized local trials with a campaign timestamp before
  `2026-07-14T00:00:00.000Z`.
- Preserve the existing one-time Stripe campaign marker so members already
  extended by this campaign cannot receive another seven days.
- Force an operator back to Batch 1 after deployment so an old continuation
  cannot skip newly eligible provider or member candidates.
- Require the cohort-closing Batch 1 zero-work pass to start only after the
  July 14 UTC cutoff has passed.
- Keep paid, canceled, expired, mismatched, and foreign-campaign subscriptions
  outside mutation paths exactly as today.

## Constraints

- Do not change normal Pulse Trial duration, allowance, checkout, or conversion
  policy.
- Do not extend a subscription twice or mutate current paid billing.
- Keep provider enumeration and member traversal bounded to four candidates per
  Preview/Apply pair.
- Preserve unrelated worktree and coordination-ledger changes.

## Approach

1. Move the fixed exclusive campaign cutoff to July 14.
2. Version the encrypted continuation namespace so all pre-change batch tokens
   fail closed and the UI resets to Batch 1.
3. Update operator copy and the durable `apps/web` billing notes.
4. Update boundary and continuation regression tests.
5. Preserve campaign ownership before obsolete provider cleanup and prove a
   foreign campaign marker cannot reach its cancellation path.
6. Run scoped verification, direct scenario proof, required completion audits,
   and the PR review/CI gates.

## State

Active.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
