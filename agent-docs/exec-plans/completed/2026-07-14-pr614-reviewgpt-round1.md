# PR 614 ReviewGPT Round 1

## Goal

Close the two evidence-backed exact-head review findings without adding a new
persisted repair witness, index, lifecycle owner, or reconciliation service.

## Evidence

- A completely missing event spine has no remaining event-owner record that can
  prove whether a later manual edit or tombstone existed. Counting provider
  deliveries cannot establish the terminal event disposition.
- An intact exact delivery already has a stable import identity and append-only
  canonical output IDs. Reversing stored roles back into individual prepared
  members can make an accepted shared-role or empty-role delivery fail only on
  retry.
- The surviving-anchor repair path computes the accepted stored member set but
  then replaces it with the synthetic baseline member set before mapping the
  missing revision.

## Plan

1. Add regressions for complete-spine loss after a manual edit or tombstone,
   accepted shared/empty-role exact no-ops, and stale-then-new surviving-anchor
   repair.
2. Delete complete-spine reconstruction and its lock-held full ingest-history
   scan; require at least one surviving event-owner revision for repair.
3. Authorize intact exact replays from the exact stored delivery and canonical
   output owner, reserving unique role-to-member inversion for missing-output
   reconstruction.
4. Pass the already-derived accepted stored role set into surviving-anchor
   repair instead of rebuilding roles from the synthetic baseline.
5. Run focused owner tests, core typecheck/coverage, required completion audits,
   close the plan, push, and start the next exact-head ReviewGPT round alongside
   CI.

## Review closure

- ReviewGPT's two high-severity candidates were reproduced and accepted. The
  implementation deletes complete-spine reconstruction and its grouped
  historical scan, authorizes intact exact replays from their stored delivery,
  and uses accepted stored roles only for surviving-anchor repair.
- The completion security pass found two additional integrity gaps: raw-only
  decisions could resurrect stale data after complete spine loss, and an
  incomparable shared-role revision could hide a missing accepted member.
  Exact raw-only delivery is now a no-op after owner loss, evidence repair is
  restricted to accepted members, and ambiguous outputs require retained proof
  for every owner member.
- A broad-suite regression showed that the ambiguous fallback also needed to
  reject stored roles unrelated to the canonical owner. The fallback now
  verifies owner-role membership, including a genuine zero-role member for an
  empty stored output.
- Final security/privacy and coverage-write reruns report zero findings.

## Verification

- All 138 device-import tests pass, including complete-spine fail-closed,
  raw-only complete-loss, opaque-version shared-role loss, accepted shared and
  empty-role no-op, surviving-anchor repair, and foreign-role rejection cases.
- `pnpm --dir packages/core typecheck` passes.
- `pnpm test:scenario-integrity` passes for 207 scenarios, 11 sample inputs,
  and 28 golden-output directories.
- Full core V8 coverage reached 90.2% statements and 81.87% branches with 669
  passing tests. Its only test failure is the unrelated pre-existing
  preferences causal-token test exceeding its 60-second timeout, followed by
  that test's temporary-directory cleanup race.
- `pnpm test:diff ...` passed policy, privacy, architecture, dependency,
  workspace-boundary, and all 18 affected typecheck gates. Its affected-test
  phase stopped on the same untouched preferences timeout after the changed
  device-import suite had already passed independently.

## Invariants

- Missing user-authored state or a tombstone must never be replaced by stale
  provider state.
- Accepted exact work remains idempotent across retry and restart even when
  several prepared members share one evidence role or have no role.
- Ambiguous role membership still fails closed when repair genuinely needs one
  prepared member.
- Repair latency does not grow with unrelated historical ingest rows while the
  canonical write lock is held.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
