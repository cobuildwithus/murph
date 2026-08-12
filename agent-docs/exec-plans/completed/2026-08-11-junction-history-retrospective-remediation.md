# Junction history retrospective remediation

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Collapse Junction extended-history completion to one writable compact owner
  and make aggregate progress depend on canonical fact production.

## Success criteria

- Blood-pressure and note legacy lists are read-only migration inputs and are
  removed atomically when their v1 bits are persisted in the matrix.
- The existing metadata patch owner supports an explicit deletion sentinel;
  ordinary null metadata retains its current persisted semantics.
- Canonical aggregate facts complete history, note remains the only explicit
  no-op, malformed/noncanonical and empty scans use the finite no-progress
  ladder, and incomplete/import failures remain retryable.
- A documented coverage-policy version bump makes previously exhausted matrix
  coverage ineligible after normalization support changes.
- Production-composed proof covers global progress, push evidence, profile,
  seven diagnostics, both legacy inputs, importer receipt, sanitizer/store,
  hosted/local merge, reopen, and scheduler suppression within 16 entries.

## Constraints

- Delete dual-write and transport-progress machinery; do not add a table,
  service, cleanup pass, cursor, or second coverage owner.
- Preserve exact blood-pressure record resolution and bounded provider windows.
- Do not run ReviewGPT.

## Tasks

1. Add narrow explicit metadata-patch deletion semantics and null regression proof.
2. Make the compact matrix the only writer and migrate legacy values through
   existing patch/hosted-merge owners.
3. Remove durable-delivery/provider-row aggregate progress and keep finite
   no-progress plus retryable incomplete/failure behavior.
4. Add composed persistence, merge, scheduler, importer, and policy-version tests.
5. Run focused tests/typechecks/diff/privacy/Frog, commit, push, and update PR stats.

## Decisions

- A unique in-process symbol is the patch deletion sentinel. It cannot collide
  with stored scalar values, and null remains an ordinary stored scalar.
- The matrix format version is also the extended-history coverage-policy
  version. Bumping it deliberately ignores older completion bits and reopens
  history after normalization support changes.
- Aggregate rows never create exact unresolved-record obligations. A completed
  import with at least one canonical event is progress; zero canonical events
  are no-progress regardless of durable evidence acceptance.

## Verification

- Focused metadata security and SQLite store tests.
- Junction hosted-runtime, provider, blood-pressure, and composed service tests.
- Real importer normalization/receipt boundary test.
- Device-syncd and importer typechecks where affected.
- `git diff --check`, privacy scan, scoped commit, push, and merge-tree proof.
Completed: 2026-08-11
