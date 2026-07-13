# PR 521 ReviewGPT Round 4 Follow-up

Status: completed
Updated: 2026-07-12

## Why

Exact replay protection currently depends too heavily on attempt-scoped ingest
identity, and one unsafe event owner can suppress repair of unrelated missing
outputs in the same delivery.

## Goal

Make the canonical event spine authoritative when a later provider poll has a
new attempt identity, and repair each missing exact-delivery output without
reverting or relinking unrelated protected owners.

## Invariants

- A delayed WHOOP revision cannot replace a newer provider revision, user edit,
  or tombstone merely because a later poll minted a new receipt identity.
- Exact-delivery repair is per output: missing events and samples are restored,
  while different, deleted, or ambiguous owners remain untouched and unlinked.
- A no-op result contains only records proven to exist in canonical storage.
- The fix uses the existing event index and version comparator; it adds no new
  state owner, replay table, queue, or lifecycle subsystem.

## Work

1. Add production-path regressions for newly timestamped WHOOP replays and
   mixed protected/missing exact-delivery outputs.
2. Preserve prior provider facts through the canonical event index even when
   exact attempt identity misses.
3. Replace batch-global repair safety with per-output association safety.
4. Run owner verification, required completion audits, final exact-head
   ReviewGPT, CI, and merge.

## Verification

- Core typecheck passed.
- Importers typecheck passed.
- Core coverage passed: 41 files, 638 tests; 90.37% statements, 81.92%
  branches, 95.75% functions, and 90.45% lines.
- Importers coverage passed: 15 files, 355 tests; 90.72% statements, 82.89%
  branches, 96.46% functions, and 90.70% lines.
- Scenario integrity passed for 205 scenarios, 11 sample inputs, and 28
  golden-output directories.
- Coverage-write added one same-WHOOP-version conflict regression; the focused
  core device-import file passed 111 tests with no remaining proof gap.
- Security/privacy review found no medium-or-higher issue.
- Diff-scoped global guards passed. Its affected-package typecheck stopped in
  unchanged `packages/hosted-execution` because the installed workspace could
  not resolve `@murphai/hosted-execution/clinical-records`; this task does not
  change that package, its manifest, or its dependency graph.
- `git diff --check` passed.

## Deployment

No coordinated deploy is required. The correction remains inside core vault
mutation behavior and importer regression coverage; it does not change a web
or Cloudflare compatibility boundary.
Completed: 2026-07-12
