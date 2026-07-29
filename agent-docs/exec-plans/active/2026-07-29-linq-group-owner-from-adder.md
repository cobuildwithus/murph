# Bind Linq group ownership to the member who added Murph

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

When Murph is added to an existing iMessage group, bind the canonical hosted
thread-container owner to the active Murph member who performed that add, not
the first eligible member who later sends a message.

## Verified boundary

- The current Murph fallback provisions an unbound Linq group from its first
  eligible message and uses that sender as `HostedThreadContainer.ownerMemberId`.
- Linq's current public `participant.added` schema identifies the chat, added
  participant, and time, but does not yet publish the human actor.
- Linq webhooks are signature-authenticated, versioned, delivered at least once,
  and deduplicated by `event_id`; the public docs give no ordering guarantee
  between participant and message events.
- The thread-container owner is already the sole authority for owner-backed
  access and optional address-book labels. A second owner field would create
  split-brain state.

## Design

1. Extend the shared typed Linq participant-add ingress contract with the
   provider's planned optional `added_by_handle` full handle.
2. After the existing provider-event duplicate fence, accept that actor only
   when the added participant is an active managed Murph line and the actor
   resolves to an active existing Murph member.
3. Reuse the canonical route ensure. Its participant-add-only entrypoint may
   correct the same account-scoped route's existing `ownerMemberId` when the
   legacy first-speaker fallback committed first.
4. Keep actor and line handles request-local. Persist no new ownership,
   provenance, queue, or pending-event state.
5. Ship compatibly with
   `HOSTED_LINQ_GROUP_OWNER_FROM_ADDER_REQUIRED=0`. Once Linq confirms the
   actor-bearing webhook is live, set it to `1`; eligible unbound messages then
   fail retryably until the participant event establishes the route.

## Required proof

- typed ingress preserves a valid actor handle and ignores actor-less payloads;
- raw actor and line handles never enter the provider-event ledger;
- duplicate participant events cannot provision or correct twice;
- unmanaged lines, unresolved/inactive actors, and cross-account routes fail
  closed;
- participant-first and message-first delivery converge on the attributed
  actor, while ordinary route ensures cannot replace an owner;
- required-mode first messages create no route, mailbox work, or wake before
  actor evidence arrives;
- existing routed-group participant context and ordinary actor-less fallback
  behavior remain intact while the rollout gate is off.

## Progress

- [x] Recover the exact PR head and merge current `main`.
- [x] Recheck Linq's official API reference, webhook guide, and current
  TypeScript SDK contract.
- [x] Replace the draft normalizer split with the typed ingress boundary.
- [ ] Complete focused and concurrency coverage.
- [ ] Run product, preliminary specialist, parent, and final ReviewGPT gates.
- [ ] Close the plan, push the exact reviewed head, and make the PR merge-ready.
