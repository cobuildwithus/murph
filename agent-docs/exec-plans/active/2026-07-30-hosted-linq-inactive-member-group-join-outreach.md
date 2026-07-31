# Hosted Linq inactive-member group-join outreach

Status: active

## Outcome and invariant

A canonical affirmative Linq group-join reaction has exactly one owner. Active members continue through direct group join; suspended members are terminally consumed; and an inactive, unsuspended verified phone member who is not already in the target group uses the existing reply-gated private outreach. No decided reaction falls through into ordinary group-runtime work.

## Current owners and evidence

- `join-offer-reaction.ts` owns member resolution, canonical-offer validation, terminal event handling, and selection between direct join and reply-gated outreach.
- `webhook-service.ts` consumes terminal canonical-offer outcomes before ordinary affirmative-reaction routing.
- `group-join-outreach-drain.ts` owns recipient revalidation, provider-phone and drain fences, quiet hours, pacing, delivery idempotency, and the link-free opener.
- Existing delivery correlation and the Linq webhook planner own the group-aware signup link after the recipient replies.

## Implemented change

1. Reused the canonical-offer transaction and existing outreach row for verified inactive phone members; suspension, active access, and target-group membership are rechecked under the member and sponsored-access locks before enqueue or terminal consumption.
2. Added explicit suspended and already-target-group outcomes and consumed them in the webhook before group-runtime fallthrough.
3. Retained the global and participant-phone drain fences. The drain now tries an existing recipient's member row without waiting across the account-deletion lock order, defers one minute when another authority owns it, and otherwise skips only suspended, active, or target-group recipients.
4. Kept the existing opener and group-aware signup copy. An accepted opener reply from a member with a persisted home route now takes precedence over generic billing and home-route responses, returns the group-aware link in the correlated chat, and leaves the durable home route unchanged.
5. Reaction removal now asks the existing revocation owner about an exact pending row regardless of the member's current access, suspension, or target-membership state. Only a currently eligible recipient can create a missing-row tombstone.
6. No schema, queue, dependency, migration, or outbound copy was added.

## Failure, retry, and deploy behavior

- Enqueue, revocation, and handled-event marking stay atomic and idempotent in the existing transaction.
- Provider entry remains inside the existing drain, participant-phone lock, provider fence, and delivery claim.
- A concurrent activation or suspension that already owns the member row causes a durable one-minute deferral and terminal recheck. If the drain owns the row, the existing provider call completes before the competing transition. Member creation remains serialized by the participant-phone lock.
- Old and new application versions share the same schema and durable row shape; rollback has no new state to interpret.

## Proof

- Focused reaction-handler coverage includes active direct join, verified inactive outreach, unverified fallback, suspended consumption, target membership, canonical-offer refusal, supported-region refusal, handled-event marking, and unlike/re-like tombstoning across later access transitions.
- Webhook coverage proves suspended and target-member canonical reactions do not build or stage ordinary group work.
- Drain coverage includes inactive send, suspended, active, target member, and in-flight recipient-authority states.
- PostgreSQL coverage invokes the real reaction-admission owner and proves activation-first direct join versus reaction-first outreach, one handled provider outcome, and one durable owner.
- PostgreSQL reply coverage exercises route-free dormant members plus lapsed members whose accepted opener is in either their persisted home chat or a different direct chat, and proves the persisted home route remains unchanged.
- PostgreSQL removal coverage proves temporary active and suspended states cannot erase a withdrawal or permit a later provider send.

## Verification

- ReviewGPT returned the scoped implementation patch. Its preliminary and final
  first-head reviews found two material routing/revocation gaps and one missing
  PostgreSQL ownership proof; the correction pass addresses all three in the
  existing owners.
- The patch applies cleanly to current `main`, and `git diff --check` passes.
- Focused Vitest passes all 253 reaction, webhook, drain, and ordinary Linq
  dispatch tests.
- The isolated real-PostgreSQL suite passes all 24 reaction-admission,
  member-creation, activation, opener, routing, reply-correlation, revocation,
  and deletion-fence cases.
- Hosted-web typecheck and targeted ESLint pass.
- Pending: corrected exact-head PR CI, final ReviewGPT correction review, and
  parent final review.

## Progress

- [x] Read repository instructions and routed owner documents.
- [x] Trace reaction, webhook, drain, delivery, and reply owners.
- [x] Implement the scoped behavior change.
- [x] Add focused tests and update live contracts.
- [x] Run focused verification and inspect the candidate diff.
- [ ] Complete exact-head PR review and CI gates.
- [ ] Close this plan only after all required evidence is green.
