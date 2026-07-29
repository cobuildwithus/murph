# Bind Linq group ownership to the member who added Murph

Status: WIP — provider actor field required for full rollout
Created: 2026-07-29
Updated: 2026-07-29

## Goal

When Murph is added to an existing iMessage group, bind the canonical hosted
thread-container owner to the human who performed that add instead of whichever
active Murph member happens to send the first later message.

## Verified current behavior

- An unbound Linq group is provisioned by the first eligible inbound group
  message, and that sender becomes `HostedThreadContainer.ownerMemberId`.
- `participant.added` already passes through the synchronous, duplicate-fenced
  provider-event transaction, but it only marks roster refresh for a route that
  already exists.
- Linq's documented `participant.added` payload identifies the added participant
  and timestamp, not the human actor who added them.
- The existing thread-container owner is already the canonical authority for
  owner-only group actions and the owner's optional address-book labels. A
  second ownership field would create split-brain state.

## Design

1. Keep the existing operational normalizer unchanged behind the public
   provider-event module, and add one request-local authority evidence value
   when the signed payload explicitly supplies `added_by_handle` and the added
   participant is the Murph line (`participant.is_me === true`).
2. Keep the raw actor and line handles out of every persisted provider-event
   projection and log field.
3. After the existing provider-event duplicate fence, resolve the actor through
   the existing phone or verified-email member identity lookup and active-access
   gate.
4. Prove the added number is an active managed Linq line, then call the existing
   `ensureHostedThreadContainerRouteTx` primitive with the actor as
   `ownerMemberId` and reuse the existing usage-referral binding.
5. Never guess from roster order, the first speaker, or participant timing. Never
   reassign an already-bound route.

This adds no table, migration, queue, ownership model, or contact-data surface.

## Current limitation

The public Linq schema does not currently include `added_by_handle`, so the new
path is intentionally dormant for today's documented payload. The current
first-message fallback remains for compatibility. Full product correctness
requires Linq to expose or confirm a signed add-actor field; after that is live,
we should separately remove or fence the first-speaker fallback so event-ordering
races cannot choose a different owner.

## Verification

```bash
pnpm --dir apps/web vitest run \
  test/hosted-onboarding-linq-participant-owner-evidence.test.ts \
  test/hosted-onboarding-linq-participant-added-owner.test.ts \
  test/hosted-onboarding-linq-participant-owner-ingest.test.ts
pnpm typecheck
pnpm test:diff apps/web agent-docs
```

Required coverage:

- explicit actor evidence binds the existing canonical route primitive;
- the documented actor-less payload remains non-authoritative;
- duplicate provider events cannot provision twice;
- raw actor and line handles are not persisted in provider-event projections;
- unmanaged lines, unresolved or inactive actors, and already-bound routes fail
  closed without ownership reassignment.
