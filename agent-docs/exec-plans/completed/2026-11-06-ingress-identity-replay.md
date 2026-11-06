# Bind provider ingress and consent gestures to original identity

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Goal

A provider redelivery repeats the operation first accepted, under the identity
first accepted. A redelivered Telegram DM cannot enter a different member's
vault after the identity moves. An exact group-button replay cannot restore
membership or sharing after leave or revocation. A Linq reaction cannot grant for
a member after its sender handle was unlinked.

## Success criteria

- Replay after a relink appends no row for the new owner and returns no pointer.
- A same-owner replay gets its original pointer. A new update is admitted normally.
- Join, disclosure, and accepted no-op gestures stay spent across leave, rejoin,
  and revocation. A genuinely new tap still works.
- Two Linq deliveries past the outer marker yield one acceptance.
- Each claim is proven with real rows on the PostgreSQL path.

## Scope

- In scope: direct Telegram admission, group offer affirmation on Telegram and Linq.
- Out of scope: Telegram group messages, whose rows belong to the container;
  Linq outreach for inactive members, which makes no grant; first-turn and roster
  work owned by other PRs in this series.

## Constraints

- Technical constraints: additive migrations only. The new checks add no provider
  call or decryption to the grant transaction.
- Product/process constraints: existing buttons keep their wire contract. A fenced
  replay sends nobody a message.

## Risks and mitigations

1. Risk: a fence drops a genuine message or tap.
   Mitigation: identity is the provider update or callback id, which a new message
   or tap never reuses. Proofs cover a new update and a new tap after each fence.
2. Risk: the event lock adds latency to direct Telegram admission.
   Mitigation: one uncontended advisory lock and one indexed metadata read in the
   existing transaction. Only copies of one update can contend.

## Tasks

1. Write failing PostgreSQL proofs against unchanged code.
2. Add the partial lookup index and the gesture receipt.
3. Fence direct admission, spend gestures in the acceptance owners, and bind the
   Linq actor through the existing hook.
4. Update the owner docs, then run the review and CI gates.

## Decisions

- One receipt for both channels, spent by the acceptance owner. Linq does not need
  a stricter marker writer, because the receipt closes its two-delivery race. No
  Telegram mailbox receipt table: the retained mailbox row is the evidence.
- The receipt is keyed to the group and holds an opaque digest, so it survives
  leave, relink, and tapper deletion, and it dies with the group.
- The spend runs after the group lock and before any mutation. A lost spend
  changes nothing, so nothing has to be rolled back.
- The legacy `replayedGrant` guard stays for grants older than receipts. A legacy
  mismatch keeps its receipt: that gesture was already spent.
- A family-prepared replay is acknowledged without a pointer. Skipping the family
  branch with that preparation would otherwise fail on every retry.
- A family acceptance writes no `telegram:update` row, so the fence cannot see it.
  An explicit token replay still stops at `family-invite-not-accepted`. Only the
  username fallback continues, and it requires the exact text `/start`, so no
  member content can cross owners. Fencing that constant would need another index
  or receipt, which it does not justify.
- Existing permission decryption inside the grant transaction is unchanged. It
  predates this work and belongs to a separate preparation change.

## Verification

- Commands to run: `hosted-onboarding-telegram-routing-postgres.test.ts` and
  `hosted-group-offer-gesture-replay-postgres.test.ts` on a migrated loopback
  database, the touched unit files, and the Web typecheck.
- Expected outcomes: all pass, and the proofs fail on the unchanged code.
Completed: 2026-11-06
