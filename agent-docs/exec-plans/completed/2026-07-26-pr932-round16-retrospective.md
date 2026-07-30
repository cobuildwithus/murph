# PR 932 Round 16 Retrospective

Status: completed

## Goal

Make same-day signup-link suppression and recovery converge from the complete
set of existing delivery facts, independent of generic/group terminal receipt
order, while preserving exact group retry context.

## Repeated mechanism

Round 14 made accepted group-aware deliveries participate in the shared daily
signup marker. Round 15 prevented an older generic failure from clearing that
marker while a distinct group-aware delivery remained live. Round 16 showed
that a later failure of that group delivery leaves the unattributed marker
stale after every delivery has failed.

## Requirement decisions to prove

- Define the daily marker as the member/day projection of current
  invite-signup delivery truth, not as identity-specific historical ownership.
- Keep `HostedLinqDelivery` as the sole owner of delivery identity, attempt
  ordering, and terminal status.
- Prefer one order-independent resolver for generic and group-aware terminal
  consequences over another asymmetric branch.
- Preserve exact group outreach reopening for the identity that failed.
- When no live signup delivery remains, release generic suppression so a later
  ordinary inbound can retry; invalid exact group context must not strand the
  person behind a stale marker.
- Add no marker attribution, table, lifecycle owner, queue, scheduler, state
  machine, or reconciliation pass.

## Ownership decision

Planner-time derivation was evaluated first and rejected. `HostedLinqDelivery`
has no indexed member/day columns; deriving on every marked inbound would scan
privacy-safe source references on the hot read path. Instead, every terminal
signup receipt now takes the existing member row lock before changing delivery
truth, and one resolver projects the complete same-member/day live set after a
failure. This keeps receipt consequences serializable without new persisted
state or a new lock owner:

- any live generic or group-aware delivery preserves daily suppression;
- a newer live attempt preserves its exact failed identity;
- a failed group identity reopens only its own outreach;
- the final failed identity clears the shared marker, regardless of receipt
  order;
- accepted or delivered receipts continue to restore the projection.

## Proof

- Reproduce generic-failed → group-failed and group-failed → generic-failed
  permutations from separate persisted delivery rows.
- Assert identical final delivery status, daily marker, and exact-outreach
  recovery state for both orders.
- Cover a revoked or deleted originating group before the next ordinary inbound.
- Preserve accepted/delivered sibling suppression and lone generic retry.
- Run focused, PostgreSQL, canonical diff, and acceptance verification.

## Evidence

- Failing regression reproduced the group-last stale marker before the fix.
- Focused delivery-store and transport suites: 141 tests passed.
- PostgreSQL proof covers generic-then-group, group-then-generic, multiple live
  group identities, and deleted originating groups before an ordinary retry.
- `pnpm test:diff apps/web`: passed (536 test files passed, 14 skipped; 6,840
  tests passed, 178 skipped; lint, typecheck, dev smoke, and production build
  passed).
- `MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance`: passed on one-shot
  Testbox `tbx_01kygj83y9m3faxc99y85bdm1s` in 5m14s, including package
  coverage and app verification.

Updated: 2026-07-26
Completed: 2026-07-26
