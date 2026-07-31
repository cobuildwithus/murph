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
4. Kept the existing opener and group-aware reply path unchanged. No schema, queue, dependency, migration, or outbound copy was added.

## Failure, retry, and deploy behavior

- Enqueue and handled-event marking stay atomic and idempotent in the existing transaction.
- Provider entry remains inside the existing drain, participant-phone lock, provider fence, and delivery claim.
- A concurrent activation or suspension that already owns the member row causes a durable one-minute deferral and terminal recheck. If the drain owns the row, the existing provider call completes before the competing transition. Member creation remains serialized by the participant-phone lock.
- Old and new application versions share the same schema and durable row shape; rollback has no new state to interpret.

## Proof

- Focused reaction-handler coverage includes active direct join, verified inactive outreach, unverified fallback, suspended consumption, target membership, canonical-offer refusal, supported-region refusal, handled-event marking, and unlike/re-like tombstoning.
- Webhook coverage proves suspended and target-member canonical reactions do not build or stage ordinary group work.
- Drain coverage includes inactive send, suspended, active, target member, and in-flight recipient-authority states.
- PostgreSQL coverage proves member-creation and activation races in both lock orders and exercises the dormant existing-member group-aware signup reply path.

## Verification

- ReviewGPT returned a scoped implementation patch, and parent inspection found
  no production identifiers or unrelated paths.
- The patch applies cleanly to current `main`, and `git diff --check` passes.
- Focused Vitest passes 94 reaction, webhook, and drain tests.
- The isolated real-PostgreSQL suite passes all 18 member-creation, activation,
  opener, reply-correlation, and deletion-fence cases.
- Hosted-web typecheck and targeted ESLint pass.
- Pending: exact-head PR CI, preliminary specialist review, final ReviewGPT,
  and parent final review.

## Progress

- [x] Read repository instructions and routed owner documents.
- [x] Trace reaction, webhook, drain, delivery, and reply owners.
- [x] Implement the scoped behavior change.
- [x] Add focused tests and update live contracts.
- [x] Run focused verification and inspect the candidate diff.
- [ ] Complete exact-head PR review and CI gates.
- [ ] Close this plan only after all required evidence is green.
