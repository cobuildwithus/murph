# Preserve date-only imports and late extraction results

Status: completed
Created: 2026-09-21
Updated: 2026-09-21

## Outcome

Resolve both accepted round-one review findings within the existing clinical
import fix, preserving supported facts without inventing times or extending the
page deadline. Finish PR #3638 with focused proof, a resolved review and green CI.

## Findings and decisions

1. Accepted: the extraction contract allows calendar-only timestamps but the new
   validator and correction guard accepted datetimes only. Reuse the existing
   strict calendar-date predicate; preserve the canonical day without coercion.
2. Accepted: optional correction could consume the shared page deadline after
   initial extraction succeeded. Pass the existing page's monotonic deadline
   into the leaf and skip correction when the full bounded attempt plus cleanup
   allowance no longer fits. Keep explicit cancellation and authority loss hard.

Both findings concern the already-authorized import reliability fix. No data
migration, production mutation, new state owner or expanded product scope.

## Product UX

Effort: Patch. Reaches: date-only clinical records in UTC and non-UTC vaults,
late but successful extraction, correction failure, cancellation and replay.
Proof: shared validator, real canonical apply/replay, composed runtime/engine
virtual-clock regression, and the production live recovery journey.
Verdict: Ready. Date-only imports retain their documented day, late successful
extractions keep their valid records, and cancellation prevents persistence.

## Tasks

1. Reproduce both regressions with focused tests.
2. Correct date admission and optional correction budget; update current owners.
3. Run affected tests/typechecks/live proof, commit, push and finish review/CI.

## Verification

- 169 focused tests passed: clinical date/schema (36), canonical enrichment,
  parent and lab admission (64), engine extraction (22), hosted runtime and
  checkpoint cancellation (37), and unchanged changelog rendering (10).
- All four affected package typechecks passed; docs drift, diff whitespace,
  complexity and parent privacy/diff review passed.
- Calendar-only records import and replay exactly once on their documented day
  in UTC, America/New_York and Asia/Tokyo. Supported dates need no correction;
  an unsupported timestamp can recover to a calendar-only value.
- The composed runtime/engine regression failed without the deadline guard:
  100 seconds of extraction plus 25 seconds of optional correction discarded
  successful outputs at the page deadline. With the guard it persists at 100
  seconds; a 50-second extraction still performs correction and persists at 75
  seconds. Explicit parent cancellation still prevents persistence.
- The focused live recovery journey passed with gpt-5.6-terra and the existing
  local subscription: one seeded extraction plus one real correction, 7,215
  provider tokens. It retained the valid calendar-only sibling, corrected a
  historical event to its exact calendar date, restored same-day provenance,
  preserved source bytes and made no canonical writes.
- Both accepted round-one findings are resolved locally at their existing
  owners, with no new durable state or lifecycle. PR #3638 still requires a
  resolved review and green CI on the pushed remediation head.
Completed: 2026-09-21
