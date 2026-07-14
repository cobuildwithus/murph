# PR 614 Round 7 Final Hardening

## Goal

Keep the Round 7 positive-proof relaxation fail-closed when stored rows map one
prepared member to different canonical outputs or full inspection remains
unsafe with an unresolved accepted member.

## Evidence

- Multiple subset/full stored rows may each belong to the same prepared owner
  while still assigning one prepared member to different output IDs.
- Full inspection can remain incomplete or unsafe; returning a no-op in that
  state would leave the unresolved accepted member silently unrepairable.

## Plan

1. Reject cross-row prepared-member mappings to different canonical output IDs.
2. Reject an unresolved no-op when authoritative exact-delivery inspection
   remains incomplete or unsafe after the full-scan attempt.
3. Strengthen the existing conflict fixture, run focused and coverage-bearing
   verification, repeat required specialist review, and commit the scoped fix.

## Invariants

- Positive stored proof is additive only when every prepared member maps to one
  canonical output ID.
- Unsafe or incomplete authority cannot silently certify convergence.
- The fix adds no persisted state, service, queue, dependency, or replay owner.

## Outcome

- Stored positive proof now records one canonical output ID per prepared member
  and rejects cross-row conflicts before any write plan is staged.
- An unresolved speculative no-op now requires a complete, safe full-history
  inspection; malformed or unreadable history fails closed without mutation.
- Same-ID subset proof remains valid, and the authoritative full-row repair
  still restores the missing revision and converges byte-stably.
- Both corrections are local guards over existing inspection and repair state;
  no new state owner, service, dependency, queue, or abstraction was added.

## Verification

- Both focused Round 7 regressions passed.
- All 155 device-import tests passed.
- `pnpm --dir packages/core typecheck` passed.
- `pnpm test:scenario-integrity` passed 207 scenarios, 11 sample inputs, and 28
  golden-output directories.
- `pnpm --dir packages/core test:coverage` passed all 687 tests at 90.22%
  statements, 81.85% branches, 95.54% functions, and 90.28% lines.
- Coverage-write and security/privacy re-audits reported zero remaining
  medium-or-higher findings and made no edits.
- `git diff --check` and scoped identifier/secret/logging scans passed.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
