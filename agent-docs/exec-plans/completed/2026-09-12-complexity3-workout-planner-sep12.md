# Simplify workout CSV session planning through Pro implementation

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Outcome and invariant

Make the workout CSV planner easier to audit while preserving every accepted
plan, rejected row, unit gate, source identity, ordering choice and diagnostic.
This is an internal refactor with no intended member-visible behavior change.

## Owner and evidence

The bounded, non-writing owner is packages/importers/src/workout-csv-planner.ts,
through planWorkoutCsvImport. Core remains the canonical write owner and
vault-usecases remains the import composition owner. No persistence changes.
The selected baseline reports buildSessions complexity 74 and file debt 67.
The coordinator interleaves row validation, unit interpretation, session
accumulation, exercise/set construction and final projection.

## Scope and design

Pro must author the primary source and focused test patch. Local work prepares
the brief, then audits, applies and verifies the returned attachment. Limit the
patch to the planner and its existing public-boundary test file.
Prefer a few cohesive private helpers for meaningful interpretation/projection
seams; retain explicit grouping and diagnostic ownership. Preserve existing
conversion and timestamp helpers. Avoid schema frameworks, generic dispatch,
new state owners, exports for tests, dependencies or threshold-driven splitting.
A remaining hotspot is acceptable when further extraction adds plumbing.

## Risks and proof

- Preserve validation precedence and partial unit-warning evidence after later
  rejection; existing public tests cover these phase-sensitive cases.
- Preserve first-seen session order, adjacent exercise blocks, empty exercise
  filtering, set numbering, zero-versus-omitted values and exact unit conversion.
- Preserve source hash identity and timestamp domain, end-time conflict checks,
  duration recovery/backfill, first metadata wins and exception behavior.
- Add only focused composed public tests for material extraction risks not
  already covered. No behavior repair is authorized by this refactor.
- No IO, retry, rollback or deploy-skew contract changes are intended.

## Tasks

1. Inspect current owner/tests and write the Pro implementation brief.
2. Parent sends the exact source archive to GPT-6 Pro and captures its patch.
3. Audit relative patch paths and complete diff; apply only authorized scope.
4. Run focused tests, importer typecheck and complexity guard; inspect privacy.
5. Close the plan with verified results and a scoped commit; parent owns
   candidate review, Ready, final ReviewGPT and exact-head CI.

## Verification

Completed local verification:

- pnpm exec vitest run --config packages/importers/vitest.config.ts --no-coverage --maxWorkers=1 packages/importers/test/workout-csv-planner.test.ts packages/importers/test/csv-parsing.test.ts
- pnpm --filter @murphai/importers typecheck
- pnpm complexity:diff
- git diff --check

Both focused files passed, 68 tests total. Importer typecheck passed with one
checker. The complexity guard passed: file debt 67 to 55 and maximum 74 to 62.
The order-sensitive buildSessions coordinator remains at 62; unchanged outer
planner 26 and duration parsers 25/22 retain their existing contracts.
Further splitting is deferred because it would obscure diagnostic ownership.
Whitespace and privacy inspection passed.

The parent confirmed GPT-6 Pro implementation provenance and reviewed the exact
returned patch. Its SHA256 was
efb8340d612aeee3e423a15f31b0b7c37519e37e89adfd22498e6111dd33ba68.
The patch applied unchanged after path/scope inspection and git apply --check.
It extracts private set construction and session projection, keeping row
validation, partial unit-warning evidence and mutable accumulation together.
Three composed test cases cover duration recovery and rejected-row isolation,
plus Strong/Hevy interleaving, empty exercise blocks, type/order precedence,
sparse zero values, metadata ownership and projection.

Source change shape is +105/-70; focused tests are +144/-0. No public API,
dependency, configuration or generated-file changes. The ordinary frozen install
and scripts/frog list passed; no task-owned friction entry was needed.
No changelog is intended because this preserves existing import behavior.
Parent-owned candidate review, final ReviewGPT and exact-head CI remain external
completion gates; these local results do not assert their completion.
Completed: 2026-09-12
