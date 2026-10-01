# Collapse browser experiment progress count selection

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal and protected invariant

Make browser experiment progress easier to read by selecting the adherence count
source once. Preserve every result field, unknown-target behavior, confidence
omission, rollup selection, and calendar/occurrence timing boundary.

## Owner and evidence

`packages/query/src/browser-replica/experiments.ts` owns this read-only projection
over canonical experiment plans and evidence. `buildProgressResult` has cyclomatic
complexity 102 and repeats the identical count-source ladder for completed,
partial, missed, and skipped sessions. It also repeats the same target eligibility
decision. Existing adherence counters remain the source of all counts.

## Scope and decisions

- Collapse duplicate selection in `buildProgressResult`; add no abstraction,
  dependency, persisted state, API, or health policy.
- Preserve separate calendar confidence and rollup cell filtering, including the
  currently unreachable calendar fallback.
- Internal behavior-preserving refactor; no Product UX or changelog change.
- Failure, retry, rollback, and deploy skew are unchanged: pure read-side local
  selection retains the same existing count owners and output schema.

## Tasks

1. Add focused public-selector assertions for count and occurrence sources,
   unsupported targets, and ambiguous targets; prove them against the base.
2. Consolidate target eligibility and select one session-count object.
3. Run the browser experiment suite, query typecheck, and complexity guard.
4. Inspect privacy and full diff, close this plan through the scoped wrapper,
   push, and open a draft PR for parent-owned review and CI admission.

## Verification

- Passed: `pnpm --dir packages/query test browser-vault-experiment-results.test.ts`
  on both the original source and the refactor: 100 tests in each run.
- Passed: `pnpm --dir packages/query typecheck`.
- Passed: `pnpm complexity:diff --base b2a559812972d70644cffb2bf43923fc9211047d -- packages/query/src/browser-replica/experiments.ts`.
  `buildProgressResult` and file maximum complexity fall from 102 to 73; file debt
  falls from 115 to 86. Source change is 19 added and 42 deleted lines.
- Reviewed remaining hotspots: progress assembly 73, run context 48, coverage
  classification 24, and unrelated anonymous parser 21. The latter three are
  unchanged; further splitting would add scope without deleting this duplication.
- Passed: `git diff --check`; source, tests, and plan reviewed for privacy.
- Final exact-head CI and any routed external review remain parent-owned.
- Existing suite covers repeated daily occurrences, confidence/grace, rollups,
  time zones, unsupported targets, stopped runs, and saved outcomes.
Completed: 2026-09-10
