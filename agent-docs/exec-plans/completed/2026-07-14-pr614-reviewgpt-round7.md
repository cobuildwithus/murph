# PR 614 ReviewGPT Round 7

## Goal

Close the exact-head stranded-association and speculative-no-op repair gaps
without adding state or a parallel replay owner.

## Evidence

- ReviewGPT completed a valid Pro-model review of `ecbc0f5faf` with the guarded
  ZIP and `REVIEW_COMPLETE` marker.
- A target-branch stale plan can leave a full-parts/V2-only association row.
  Later retries treat its omitted V1 mapping as a veto and keep the occupied
  pre-repair association identity, so the accepted V1 revision cannot converge.
- Bounded candidate inspection can miss an older exact row while a recent
  noncandidate delivery proves the same evidence non-novel, allowing a no-op
  before authoritative full inspection can repair the missing accepted member.

## Plan

1. Add production-faithful failing regressions for the stranded association
   byproduct and the speculative no-op path.
2. Aggregate positive, uniquely invertible repair mappings across authoritative
   exact deliveries; subset rows must not revoke complete positive proof.
3. Derive or reuse association identity only after authoritative final outputs
   are known.
4. Require authoritative full inspection before a speculative no-op when a
   baseline member remains unresolved and bounded history is incomplete.
5. Run focused and full owner verification, required completion audits, close
   the plan, push, and start the next exact-head ReviewGPT round with CI.

## Invariants

- Append-only stored outputs are immutable positive proof; omission in another
  row is not a revocation, while conflicting positive mappings fail closed.
- Association identity derives from the final authoritative output facts.
- A bounded fast-path no-op is allowed only when every baseline retained member
  is already resolved or candidate inspection is authoritative.
- The fix adds no persisted state, dependency, service, queue, or compatibility
  layer.

## Outcome

- Stored subset rows now contribute immutable positive role proof without
  revoking a complete row's uniquely invertible member mapping. Unknown or
  conflicting output ownership still fails closed.
- Association identity is derived from the final authoritative event outputs.
  When that final identity was not part of candidate inspection, the existing
  append planner performs a full collision check before any append.
- A speculative no-op with an unresolved baseline member now triggers full
  candidate inspection and authoritative replanning when bounded history is
  incomplete or unsafe.
- Regressions seed the exact stranded full-parts/V2-only association, prove the
  final V1+V2 association identity and uniqueness, and prove that a recent
  noncandidate novelty row cannot substitute for the older exact repair row.

## Verification

- `pnpm --dir packages/core typecheck` passed.
- `pnpm test:scenario-integrity` passed for 207 scenarios, 11 sample inputs,
  and 28 golden-output directories.
- `pnpm --dir packages/core exec vitest run test/device-import.test.ts` passed
  all 155 tests.
- The strengthened focused Round 7 regression pair passed all 2 tests.
- `pnpm --dir packages/core test:coverage` passed all 687 tests with 90.21%
  statements, 81.82% branches, 95.54% functions, and 90.27% lines.
- Coverage-write and security/privacy completion audits reported no unresolved
  findings; the coverage pass made only the recorded test-strengthening edit.
- `git diff --check` and scoped identifier, secret, and credential scans passed.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
