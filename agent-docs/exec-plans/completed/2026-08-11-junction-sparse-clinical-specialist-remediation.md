# Remediate Junction sparse-clinical specialist findings

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Make the sparse-clinical 100-reading boundary import-wide, deterministic,
  and truthful after validation and deduplication.
- Prove stable Junction provider identity carries a corrected sparse reading
  through canonical revision 2 and makes an exact replay a no-op.

## Success criteria

- At most 100 compact sparse-clinical events survive one import across all
  seven resources, independent of resource and array ordering.
- Malformed and duplicate prefixes cannot suppress later valid readings.
- One compact overflow artifact reports validated, retained, and dropped
  unique-reading counts without provider IDs or raw arrays.
- A core vault roundtrip preserves one canonical event across value correction,
  appends revision 2 with updated compact evidence, and skips exact replay.
- Focused importer, core, and provider tests plus relevant typechecks pass.

## Scope

- In scope: Junction sparse-clinical normalization, its importer/core contract
  tests, and documentation needed to keep PR claims accurate.
- Out of scope: full timeseries retention, provider snapshots, medication
  identity, new resources, or ReviewGPT execution owned by the parent task.

## Constraints

- Retain only compact clinical facts and source provenance; never persist raw
  samples, provider IDs, provider snapshots, medication payloads, or arrays.
- Reuse the existing canonical event/evidence import boundary and stable
  external-reference semantics.
- Prefer one explicit candidate pipeline over a new state owner or abstraction.

## Risks and mitigations

1. Risk: duplicate corrections make selection input-order-dependent.
   Mitigation: choose a deterministic candidate per canonical identity, then
   sort unique candidates by occurrence and canonical identity before capping.
2. Risk: overflow evidence leaks the rejected payload.
   Mitigation: retain aggregate counts only and assert privacy over events,
   evidence, samples, and ingest receipts.
3. Risk: stable IDs accidentally incorporate mutable clinical values.
   Mitigation: core-roundtrip a value correction through an accepted ID alias
   and verify revision/replay behavior in the vault.

## Tasks

1. [x] Trace the current cap, dedupe, identity, overflow, and revision paths.
2. [x] Implement one post-validation import-wide candidate budget.
3. [x] Add deterministic-cap/privacy and correction/replay regressions.
4. [x] Run focused tests, typechecks, and diff/privacy/Frog checks.
5. [x] Prepare the scoped remediation for commit and PR refresh.

## Decisions

- Aggregate all seven sparse resources in `normalizeTimeseries`, validate each
  record before selection, deduplicate by its canonical external-reference
  identity, and retain the first 100 after deterministic ordering.
- Prefer the newest normalized `recordedAt` for duplicate provider identities;
  use a stable normalized-content key as the final tie-breaker.
- Emit one import-wide overflow artifact with counts only.

## Verification

- Focused Junction importer tests covering bounded selection, privacy, and the
  core correction/replay roundtrip.
- Focused core device-import and Junction provider tests.
- Importers, core, and device-syncd typechecks.
- `git diff --check`, privacy scan, Frog review, and final scoped diff review.
- Passed the full Junction importer file: 150 tests.
- Passed the focused sparse importer/core roundtrip: 5 tests.
- Passed the focused core unchanged-evidence revision test: 1 test.
- Passed the focused Junction sparse provider tests: 3 tests.
- Passed importers, core, and device-syncd typechecks.
Completed: 2026-08-11
