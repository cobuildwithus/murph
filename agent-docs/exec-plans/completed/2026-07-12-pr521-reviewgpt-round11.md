# PR 521 ReviewGPT Round 11 fixes

## Goal

Close the two validated Round 11 findings without adding durable state or a
second ownership layer, then continue ReviewGPT to a clean exact-head result.

## Success criteria

- Stored event-output repair rejects cross-owner deterministic ID claims before
  reconciliation or writes.
- Raw-only first imports and exact replays return no canonical events when the
  stored delivery has no event outputs.
- Focused regression tests prove both failures and byte-stable rejection or
  replay behavior.
- Required core verification, completion audits, exact-head ReviewGPT, and CI
  pass before merge.

## Constraints

- Preserve stable event identities and existing legitimate historical-owner
  repair.
- Keep ownership transient and explicit; add no durable index, queue, service,
  or compatibility layer.
- Preserve unrelated working-tree and coordination-ledger work.

## Approach

1. Add focused reproductions for swapped missing-event output IDs and raw-only
   replacement-owner return leakage.
2. Replace split repair reservations with one owner-aware output claim map.
3. Derive returned events from physically authorized delivery outputs or actual
   appends, including exact no-op replay.
4. Run focused and full core verification plus required completion audits.
5. Continue exact-head ReviewGPT rounds until clean, push, prove CI green, and
   merge PR 521.

## State

Active.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
