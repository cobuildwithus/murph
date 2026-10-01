# Simplify workout CSV load metadata and set assembly

## Outcome and protected contract

Reduce duplicated decisions in `buildSessions` while preserving the complete
Strong/Hevy planning result. The existing non-writing importer remains the owner;
canonical persistence, source identity, grouping, output order, numeric handling,
unit authority, skip reasons and warning timing must stay unchanged.

## Evidence and design

The complexity guard reports `buildSessions` and the file maximum at 111, file
debt 104, and total complexity 417. Primary and three auxiliary loads repeat unit
resolution/conflict logic; optional set values repeat presence decisions during
assembly and again during set admission.

Reuse one local weight metadata resolver for the four load fields, preserving
primary validation before auxiliary validation and metadata conflicts before
explicit-option conflicts. Keep each unitless warning update in its original
phase: later rejection can preserve a warning. Build the typed optional set
values once, omit undefined values in one pass, and derive set admission from
the resulting object. No new state owner, dependency, public API, or persistence
behavior is needed; failure, retry, and deployment contracts remain unchanged.

## Product UX and proof

Internal maintainability refactor; replay existing planner cases plus synthetic
sparse/zero/invalid set values and competing metadata conflicts. Verify exact
set shape, grouping, IDs, skip-reason precedence, and unit-warning timing. Run
the focused workout CSV suite, importer typecheck, and complexity guard. Use a
bounded base/head differential matrix if it adds coverage of field combinations.
Broad exact-head CI and final review remain with the parent completion owner.

## Progress

- [x] Trace source, contract, and existing tests; inspect Frog entries.
- [x] Add focused boundary evidence and simplify the existing owner.
- [x] Run focused proof, typecheck, complexity guard, and privacy/diff review.
- [x] Prepare the scoped final commit and complete draft PR; parent owns readiness and final gates.

## Completion evidence

- Focused planner suite: 50 tests passed, including sparse output, zero/invalid
  values, metadata authority, and warning/skip precedence.
- Temporary differential suite: 2,886 complete base/head plans matched, covering
  all 512 optional-field combinations with zero, positive, and fractional values
  plus 1,350 combinations of primary/auxiliary units, headers, and overrides.
  The temporary baseline copy and harness were removed after passing.
- `pnpm --dir packages/importers typecheck`: passed.
- `pnpm complexity:diff --base HEAD -- packages/importers/src/workout-csv-planner.ts`:
  passed; `buildSessions`/file maximum 111 → 74, file debt 104 → 67.
- Source shape: +63/-69 lines. Tests add 125 lines. Numeric presence validation
  and weight-header inference also use one repeated-rule pass.
- Remaining changed-file hotspots: `buildSessions` 74 retains existing identity,
  session, and dialect sequencing. Unchanged parsers remain 22 and 25; the
  public planner remains 26. Further extraction would relocate policy without
  removing a demonstrated duplicate in this scoped change.
- Full diff and `git diff --check` reviewed; only synthetic test values and
  neutral Git metadata are used. No new reproducible repository friction.
- Product UX: Ready at the planner boundary; no product behavior, schema,
  persistence, provider input, or foreground reply path changed. Broad CI and
  any routed final review are pending with the parent completion owner.
Status: completed
Updated: 2026-09-10
Completed: 2026-09-10
