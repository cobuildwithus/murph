# Collapse repeated Oura daily normalization

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Remove repeated daily-resource normalization in the Oura importer while preserving
the complete normalized device payload and existing canonical ownership.

## Success criteria

- Replace four duplicated daily loops with one explicitly ordered resource loop.
- Preserve event and evidence ordering, fallback identities, timestamps, facets,
  summary grain, metric omission, collection counts, and SpO2 alias precedence.
- Reduce source lines and measured complexity without moving branches elsewhere.
- Pass focused provider tests, importers typecheck, and Cyclomatic Complexity Guard.

## Scope

- Oura normalizer and existing Oura coverage tests.
- No transport, canonical writer, schema, public API, or other provider changes.

## Constraints

The importer remains the parsing and normalization owner; core remains the sole
canonical writer. Existing metric descriptors and evidence helpers retain all
validation and emission behavior. No new state, dependency, or shared framework.

## Risks and mitigations

1. Resource ordering determines fallback IDs from the current event count.
   Keep activity, sleep summary, readiness, and SpO2 order explicit and test
   missing identities, skipped metrics, and the subsequent sleep resource.
2. Empty objects count in provenance but emit no evidence or metrics.
   Exercise invalid records and compare evidence contents and collection counts.
3. Date-only identity, timestamp version, and provider-local day have distinct
   fallback rules. Assert each through the actual normalizer before refactoring.

## Tasks

1. Add and run synthetic compatibility cases against the existing normalizer.
2. Collapse the repeated daily loops at their existing owner.
3. Run focused provider proof, typecheck, complexity guard, and inspect the diff.
4. Close the plan with the scoped commit; push and open a draft PR for parent review.

## Decisions

- Keep prefiltered arrays because they already own provenance counts.
- Keep sleep, session, workout, and deletion branches in place.
- Internal behavior-preserving refactor: no product flow or changelog change.
- Parent owns candidate admission, exact-head CI, and final ReviewGPT.

## Verification

- Focused Vitest: Oura coverage, device-provider normalization, and deletion normalization.
- Typecheck: `pnpm --dir packages/importers typecheck`.
- Guard: `pnpm complexity:diff --base origin/main -- packages/importers/src/device-providers/oura.ts`.
- Baseline compatibility: all 10 Oura coverage cases pass against the original
  normalizer, including the six new cases.
- Candidate: all 92 tests pass across the three focused files.
- Importers typecheck passes.
- Cyclomatic Complexity Guard passes: target/file maximum 66 -> 55; file debt
  above threshold 20 falls from 46 -> 35. Source changes are +32 / -99 lines.
- Remaining complexity is the existing distinct sleep, session, workout, and
  deletion behavior. Splitting those branches would relocate complexity rather
  than remove demonstrated duplication.
- Diff whitespace and privacy inspection pass. No new Frog entry was needed;
  the frozen install and ordinary repository checks succeeded.
- Local implementation and proof are complete. Draft PR handoff retains parent
  ownership of candidate admission, exact-head CI, and final ReviewGPT.
Completed: 2026-09-10
