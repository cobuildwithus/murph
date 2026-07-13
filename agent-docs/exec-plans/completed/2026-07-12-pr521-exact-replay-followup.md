# PR 521 Exact-Replay Audit Follow-up

Status: completed
Updated: 2026-07-12

## Why

Completion audits against the ReviewGPT correction reproduced cross-product
failures between damaged historical ingest rows, newer canonical event state,
repeated output loss, and bounded tail misses.

## Goal

Preserve newer or user-owned canonical state for every exact replay, repair
partial or invalid historical delivery evidence only when current ownership is
safe, restore missing outputs repeatedly without duplicate ingest rows, and
avoid a full monthly ingest scan when bounded novelty already proves a no-op.

## Invariants

- Exact replay never reverts a newer revision, user edit, tombstone, distinct
  dedupe survivor, or other non-equivalent current owner.
- Partial and integrity-invalid exact rows may trigger a safe append-only repair
  but cannot authorize stale event reconciliation.
- A full target-shard scan happens only when persistence or exact-candidate
  disambiguation is required, and its result is reused by append planning.
- Repeated missing-output repair reuses the same deterministic association row.

## Work

1. Separate candidate identity from complete delivery authorization.
2. Make provisional reconciliation repeatable and delay the authoritative scan.
3. Add regressions for damaged-row/newer-revision, bounded semantic no-op,
   repeated output loss, and mixed association ownership.
4. Run owner verification, completion re-audits, final diff review, and CI.

## Verification

- Core typecheck passed.
- Focused device-import and ingest tests passed: 2 files, 140 tests.
- Core coverage passed: 41 files, 636 tests; 90.41% statements, 81.88%
  branches, 95.74% functions, and 90.49% lines.
- Scenario integrity passed for 205 scenarios, 11 sample inputs, and 28
  golden-output directories.
- Coverage-write, security/privacy, and final logic/simplicity re-audits found
  no unresolved material findings.
- `pnpm test:diff packages/core/src/mutations.ts
  packages/core/test/device-import.test.ts` passed all global guards, 18
  affected package typechecks, and affected package tests. Its final unchanged
  hosted-local package-boundary probe hit a fixed 10-second timeout; the exact
  package-resolution import completed successfully in 28 seconds, and this PR
  does not change the harness or either package built by that check.

## Deployment

No coordinated deploy is required. The change remains within core vault
mutation behavior and does not cross the web/Worker compatibility boundary.
Completed: 2026-07-12
