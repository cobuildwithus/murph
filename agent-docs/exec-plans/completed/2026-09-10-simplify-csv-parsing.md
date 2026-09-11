# Separate CSV parsing from sample import planning

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Give the sample and workout CSV planners one explicit parsing owner, removing
the workout planner's dependency on sample planning and vault loading while
preserving accepted input, timestamps, errors, and public exports.

## Success criteria

- Both planners import the same unchanged CSV parsing algorithms directly.
- The public `parseDelimitedRows` export points to its actual owner.
- Focused importer tests, package boundaries, typecheck, emitted build, and
  complexity checks pass; the final diff contains only this extraction.

## Scope and constraints

- Move CSV row parsing and flexible timestamp normalization into internal
  `csv-parsing.ts`; reuse contracts timestamp primitives and shared string validation.
- Keep file reads, vault timezone discovery, sample inference and summaries in
  the sample planner. Keep workout unit gates and source identity in its planner.
- Remove the sample importer's parser pass-through. Add no public package subpath.
- Preserve function bodies, error messages, timestamp precedence, CSV quoting,
  row ordering, and the current timezone conversion behavior exactly.
- No device-sync, provider normalization, or public product behavior changes.

## Tasks

1. Move the existing parsing cluster and update direct imports/exports.
2. Add focused timestamp and module-dependency proof; document the internal owner.
3. Run focused tests, typecheck, emitted build, and complexity checks.
4. Review privacy and the exact move, close this plan with a scoped commit,
   and push a draft PR for parent candidate review and final CI/review gates.

## Decisions

- A concrete internal CSV module removes a current cross-planner dependency;
  adding a generic parser framework or a compatibility reexport is unnecessary.
- Existing composed tests cover public CSV parsing, sample writes, and workout
  timestamps. Direct proof will cover timestamp variants and independent loading.
- No changelog: this is internal ownership cleanup with identical import behavior.
- Root owns Ready, ReviewGPT, CI, and final completion; this lane stops at draft handoff.

## Verification

- Passed: importer Vitest with `--maxWorkers=2 --no-coverage` for
  `csv-parsing.test.ts`, `importers.test.ts`,
  `importers-factory-core-coverage.test.ts`, `workout-csv-planner.test.ts`, and
  `package-boundary.test.ts`: 129 tests across five files.
- Passed: `pnpm --dir packages/importers typecheck` and
  `pnpm --dir packages/importers build`.
- Passed: `pnpm complexity:diff --base b80bd40f84d1b367c1810e2fe046e3089cc28aa4`:
  six exact function moves; parsing owner maximum 14, no complexity debt.
  Existing workout hotspots remain unchanged: `buildSessions` 74,
  `planWorkoutCsvImport` 26, `parseDurationMinutes` 25, and
  `parseSetDurationSeconds` 22. Their unit, identity, and duration policies stay
  cohesive and are outside this parsing extraction.
- Passed: exact month/type, timestamp, and CSV source-block comparison to the
  reviewed base; full diff review, `git diff --check`, and task-file privacy scan.
- Passed: emitted public `parseDelimitedRows` is the same function as the
  parsing owner and accepts quoted CSV fields.
- Parent candidate review passed with no requested source changes.
- Frozen dependency install passed. Frog inventory reviewed; no task-created
  friction entry or workaround was necessary.
- Required broad CI and final review remain with the root completion owner.
Completed: 2026-09-10
