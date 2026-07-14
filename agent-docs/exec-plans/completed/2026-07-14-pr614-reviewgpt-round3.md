# PR 614 ReviewGPT Round 3

## Goal

Validate and close the exact-head unsafe-evidence and stale-then-new replay
findings while keeping event reconciliation as the only provider-revision
decision owner.

## Evidence

- ReviewGPT completed a valid Pro-model review of `3c231703d7` with the guarded
  ZIP and `REVIEW_COMPLETE` marker.
- The review identified two production-boundary hypotheses: partial, invalid,
  or unsafe exact evidence may bypass complete-spine loss protection; and an
  unseen stale member before a newer member may be accepted once but rejected
  on exact retry when a middle revision already exists.
- Both findings require focused failing tests before implementation.

## Plan

1. Add production-boundary regressions for partial/invalid/unsafe exact evidence
   after complete event-spine loss and for fresh stale-then-new delivery against
   a preexisting middle revision.
2. Reject or narrow any finding that does not reproduce from reachable state.
3. If reproduced, expose the existing input-order reconciliation dispositions
   and reuse them for exact replay and persistence instead of inferring a second
   decision from baseline roles and historical fingerprints.
4. Route every observed-but-untrusted exact identity through the complete-spine
   fail-closed guard, including any authority change after full inspection.
5. Run focused and full owner verification, required completion audits, close
   the plan, push, and start the next exact-head ReviewGPT round with CI.

## Invariants

- Observed partial, invalid, duplicate, or unsafe exact identity cannot
  authorize reconstruction after complete owner loss.
- Every accepted delivery must converge under a byte-identical retry, including
  stale-then-new input order against preexisting provider state.
- User edits, tombstones, provider-version ordering, raw-only decisions, and
  surviving-anchor repair remain protected.
- The fix adds no persisted witness, index, service, queue, or compatibility
  layer.

## Outcome

- Reproduced and accepted both Round 3 findings at the production boundary.
- Added the existing reconciliation loop's retained-member disposition to its
  transient result and reused that result for exact replay authorization and
  normal persistence. This deletes the parallel replay-time inference from
  version and historical-content heuristics without adding persisted state.
- Classified any observed but non-authoritative exact identity as untrusted and
  require a surviving event-owner revision before persistence may append an
  event. Full inspection now rebuilds persistence when this authority state
  changes, even if the evidence-repair boolean does not.
- Preserved changed-content-after-deletion behavior, user-edit conflict
  rejection, anchored historical repair, deterministic no-`externalRef`
  identity, and sample/evidence-only repair.
- Added regressions for partial and integrity-invalid exact evidence across edit
  and tombstone complete-loss states, unsafe output-empty history after owner
  loss, and fresh stale-then-new delivery against a preexisting middle revision
  for distinct, shared, and roleless evidence.

## Verification

- `pnpm --dir packages/core exec vitest run test/device-import.test.ts`: 149
  passed.
- `pnpm --dir packages/core typecheck`: passed.
- `pnpm test:scenario-integrity`: passed for 207 scenarios, 11 sample inputs,
  and 28 golden directories.
- Full core coverage: 680 passed and one unrelated pre-existing
  `preferences.test.ts` 60-second timeout; 90.18% statements, 81.76% branches,
  95.53% functions, and 90.23% lines.
- Required coverage-write audit: zero medium-or-higher findings.
- Required security/privacy audit: zero medium-or-higher findings.
- `git diff --check` and the scoped privacy/console scan: passed.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
