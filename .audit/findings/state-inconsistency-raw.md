# Family Draft Recovery — State Inconsistency Raw Audit

## Scope

- Runtime: TypeScript, Next.js, Prisma/PostgreSQL, Stripe Node SDK.
- Boundary: explicit Family invite recovery, Checkout attempt replay, provider
  retirement, completion/expiry reconciliation, and owner-draft deletion.

## Coupled state dependency map

1. `HostedAccountGroup.id` and `ownerMemberId` identify the exact owner draft.
   A recovery projected from one group must never rediscover another group as
   its mutation target.
2. `checkoutAttemptId`, `checkoutCreatedAt`, and `checkoutSeatCount` form one
   unbound Checkout claim. A replay must use the exact attempt and its stored
   seat count.
3. `stripeCheckoutSessionIdEncrypted` and its lookup key bind one provider
   Session to that exact group and attempt. Session metadata must agree with all
   three identities.
4. A bound Subscription supersedes Checkout authority. Completion binds the
   Subscription and clears the complete Checkout claim as one billing write.
5. Draft eligibility is coupled to the owner-only roster, pending invites,
   paid capacity, suspension, billing status, Customer/Subscription authority,
   and the complete Checkout-claim shape.

## Mutation matrix

| State | Mutation owner | Required coupled action |
| --- | --- | --- |
| Group ownership | normal group creation/deletion | owner lookup and exact group identity remain consistent |
| Unbound claim | `writeHostedFamilyCheckoutAttemptTx` | write attempt, creation time, seat count; clear old Session fields |
| Bound Session | `bindHostedFamilyCheckoutSessionTx` | compare exact group and attempt before storing Session identity |
| Expired Session | `applyHostedFamilyStripeCheckoutExpiredTx` | clear all claim and Session fields under exact group/attempt/Session predicates |
| Completed Session | `writeHostedAccountGroupStripeBillingTx` | bind Customer/Subscription and clear all Checkout authority |
| Draft deletion | `abandonHostedFamilyDraftCandidateTx` | lock owner, re-read all draft relations, compare the complete prepared claim |

## Raw candidates

### SI-001 — Stale invite recovery can consume a replacement Checkout

- Coupled pair: projected group/attempt identity and provider/deletion target.
- Breaking path: the route projected only `checkout_starting`, then selected the
  owner's current group and accepted any current attempt.
- Trigger: request A projects G1/K1; request B deletes G1; request C creates
  G2/K2; A resumes and retires G2/K2.
- Raw severity: Medium.
- Verification: reproduced by route and service regressions; true positive.

### SI-002 — Projection can become stale before replay

- Candidate: the recovery read is not held under a transaction through Stripe.
- Verification: expected designed staleness. Exact group comparison at the
  route, exact attempt comparison under the owner lock, and exact candidate
  revalidation before deletion reject every changed identity before it can
  affect replacement provider state. False positive after SI-001 correction.

### SI-003 — Expiry reconciliation can clear a prepared candidate

- Candidate: an expiry webhook clears the Checkout claim between provider
  preparation and deletion.
- Verification: designed lazy reconciliation. Deletion accepts the cleared
  shape only when the prepared exact Session was proved retired and every claim
  and Session field is empty. Any replacement field rejects. False positive.

### SI-004 — Completion clears the attempt before a delayed binder resumes

- Candidate: a duplicate provider response may see its attempt disappear.
- Verification: the late binder retrieves the exact terminal Session, preserves
  an already-bound exact Subscription, applies completion only while the exact
  claim survives, and destructively closes completed authority only when the
  original group is absent. Existing race regression passes. False positive.
