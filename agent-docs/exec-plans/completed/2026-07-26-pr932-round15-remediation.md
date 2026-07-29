# PR 932 Round 15 Remediation

Status: completed

## Goal

Keep the shared same-day signup-link fact monotonic across independent generic
and group-aware delivery identities, while preserving exact retry ownership for
the identity that actually failed.

## Proven gap

A group-aware signup success now sets the shared daily marker, but a delayed
failure for an independent generic signup identity can still clear that marker.
Because the group outreach is already consumed, a later ordinary inbound can
then receive a competing generic signup link that drops the group destination.

## Direction

- Keep `HostedLinqDelivery` as the delivery-identity and attempt-order owner.
- Before a generic failure clears the shared daily marker, determine whether a
  distinct same-member/day invite-signup delivery remains live at the provider
  boundary, accepted, or delivered.
- Suppress only that generic marker release when another delivery identity still
  justifies the shared fact.
- Keep group failure scoped to reopening its exact outreach.
- Add no table, marker attribution field, queue, state machine, or reconciliation
  owner.

## Proof

- Generic accepted send, later group-aware success, then delayed generic failure
  keeps the marker and consumed outreach intact.
- The equivalent receipt-before-milestone replay ordering converges.
- A lone generic failure with no other successful/live identity still clears the
  marker and preserves generic retry.
- Production-faithful PostgreSQL coverage represents generic and group identities
  as separate persisted delivery rows.
- Canonical focused, diff, and acceptance verification as routed.

Updated: 2026-07-26
Completed: 2026-07-26
