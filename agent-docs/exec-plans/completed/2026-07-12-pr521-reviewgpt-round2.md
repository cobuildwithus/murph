# PR 521 ReviewGPT Round 2

Status: completed
Updated: 2026-07-12

## Why

ReviewGPT round 2 proved that exact-delivery detection ignored current canonical
owners, filtered evidence rows could depend on an older row that was later
missing or corrupt, production-shaped legacy receipt ids were not recognized,
live shards without a terminal newline could be corrupted by append, and the
exact-id preflight introduced duplicate unbounded target-shard scans.

## Goal

Authorize a replayed delivery from current canonical ownership before content
reconciliation, append deterministic association revisions when ownership
changes, keep each written device delivery's evidence self-contained, preserve
the parent metadata-and-receipt identity as a read candidate, repair valid
missing-newline boundaries, and reuse one authoritative target inspection for
append planning when the bounded tail cannot decide.

## Invariants

- Exact v1 replay after v2, user edits, or tombstones cannot make stale provider
  content current or fail merely because the current revision changed.
- A valid stored delivery is accepted only when its provider, account, source,
  timestamp, receipt, full metadata-aware evidence identity, and current
  canonical output associations match.
- New rows contain the complete received evidence set; corrupt exact rows repair
  under a deterministic association-revision id and the repair replay is a
  no-op.
- A complete final row without its delimiter is separated from the append by
  exactly one newline; an incomplete final row remains unchanged and rejects.
- Recent exact replays stop in the bounded tail. A tail miss may perform one
  authoritative full target scan that append planning reuses.
- No new index, store, queue, or lifecycle owner is introduced.

## Work

1. Add bounded exact-id inspection with a reusable planner authority.
2. Resolve current canonical event ownership before content reconciliation,
   recognize strict legacy ids, and append association revisions when needed.
3. Persist self-contained evidence rows and add focused replay, repair, and
   bounded-tail and missing-newline proof.
4. Run owner tests/typechecks, coverage-write, pushed-head ReviewGPT, and CI to
   zero accepted findings.

## Verification

- Core tests: 41 files, 628 tests passed.
- Core build and core/importer typechecks passed.
- Importer tests: 15 files, 352 tests passed.
- Scenario integrity: 205 scenarios, 11 sample inputs, and 28 golden-output
  directories passed.
- Coverage-write audit completed with no unresolved actionable findings.
- `pnpm test:diff` passed repository guards and all affected typechecks except
  the unrelated `packages/cli` target, whose installed `incur` declaration does
  not expose the existing `skillHash` references. This diff does not touch the
  CLI, dependency manifests, patches, or lockfile; scoped owner checks pass.
- Remaining pushed-head ReviewGPT and CI gates pending.

## Deployment

No coordinated deploy is required. This changes core vault mutation behavior
without crossing the web/Worker deployment boundary.
Completed: 2026-07-12
