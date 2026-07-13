# PR 604 ReviewGPT Round 2

## Goal

Make persisted device-event roles and historical shard repair consume the same
retained reconciliation decision, including when a canonical event predates the
delivery or a later delivery has advanced the spine.

## Evidence

- ReviewGPT completed a valid exact-head review at `705e6bcbec3` with the
  requested model, guarded ZIP, exact-turn capture, and `REVIEW_COMPLETE`.
- High finding 1: for a pre-existing canonical event, current-owner association
  can persist evidence roles from a byte-equivalent prepared row that baseline
  reconciliation rejected; replay expects only the retained role.
- High finding 2: partial historical repair anchors revision placement to the
  current row's content. Once a later delivery advances the spine, no baseline
  member matches current content, so the missing historical row is not rebuilt
  and an empty repair delivery can be accepted.

## Plan

1. Add production-shaped regressions for a pre-existing equivalent duplicate
   with distinct roles and for an earlier cross-month delivery replayed after a
   later revision advances the same canonical spine.
2. Make persistence roles intersect the existing baseline-retained decision;
   do not introduce a second retained-member predicate.
3. Carry the smallest transient historical match proof needed to derive a
   unique revision offset from surviving members of the replayed delivery;
   verify the target revision is absent and fail closed on disagreement.
4. Prevent an ingest from recording repair success until every requested
   missing output was restored or independently proven present.
5. Preserve duplicate, stale, user-edit, tombstone, occupied-output, alias,
   and unrelated-owner protections; run owner verification and fresh required
   audits before the next exact-head review.

## Invariants

- One baseline reconciliation decision owns retained membership for persisted
  roles, exact replay, and repair.
- Historical repair uses surviving rows from the replayed delivery as explicit
  revision anchors and never derives occurrence identity from content alone.
- Later current revisions remain byte-stable; missing targets must be absent
  and unambiguous before append.
- No new durable state, generic reconciliation subsystem, or parallel identity
  resolver is introduced.

## Implementation

- Intersect protected, reconciled, appended, and associable prepared events
  with the existing baseline-retained set, so persistence, exact replay, and
  repair use one retained-role authority.
- Extend the transient event index from historical owner IDs to owner revision
  sets and retain the occupied revisions for each canonical event ID.
- Derive historical repair placement by intersecting offsets proven by every
  surviving retained member; require one offset, an absent target revision,
  and a target older than the untouched current row.
- Keep incoming newer corrections on the ordinary reconciliation path, reject
  repeated-content or occupied-revision ambiguity, and refuse repair completion
  when a current-row repair request was not safely reconstructed.
- Decline the suggested broad reconciliation-trace refactor: the accepted bugs
  are closed by one retained-set filter and narrow transient revision proof,
  without changing the resolver API or adding generic state.

## Verification

- Both accepted High findings failed in focused importer-boundary regressions
  before the correction and pass afterward.
- Exact post-main-merge device-import plus integration-ingest suite passed
  164/164 tests.
- Core typecheck passed after the final coverage-only test addition.
- Full core coverage passed 41 files and 665 tests: 90.15% statements, 81.78%
  branches, 95.52% functions, and 90.21% lines.
- `pnpm test:diff packages/core/src/mutations.ts packages/core/test/device-import.test.ts`
  passed dependency policy, workspace boundaries/cycles, runtime/privacy guards,
  and all 18 affected typechecks after refreshing ignored build artifacts and
  workspace links from the merged base. Its concurrent package-test phase
  stopped on unchanged assistant CLI/runtime tests reaching their 60-second
  timeout; the changed core owner and coverage suites are green above.
- The repeated-content anchor case fails closed without modifying surviving
  shards; the occupied-target revision case also fails closed and preserves
  event, ingest, and audit bytes.
- `git diff --check` passed.

## Completion Audits

- Fresh `security-privacy-review`: zero evidence-backed medium-or-higher
  findings, no identifier/secret leakage, and ten focused ownership/repair
  safety tests passed.
- Fresh `coverage-write`: added only the missing occupied-target revision proof;
  its focused two-test run and broader 18-test protection sweep passed, with no
  remaining material gap.
- Parent scope-and-shape review: the change upgrades an existing transient
  owner index with revision proof and removes divergent retained membership
  from persistence. It adds no durable state, package boundary, queue, or
  second resolver; the broader trace abstraction remains unjustified.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
Completed: 2026-07-13
