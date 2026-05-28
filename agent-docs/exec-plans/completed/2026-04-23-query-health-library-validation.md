# Query health-library validation

Status: in_progress
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Make `packages/query` fail closed when a canonical `bank/library/**` page parses but does not provide a usable `slug` or valid `entityType`.
- Keep the tolerant read path explicit by recording validation issues instead of silently dropping malformed canonical pages.

## Success criteria

- `readHealthLibraryGraph()` throws a validation failure when a parsed library page lacks a usable `slug` or valid `entityType`.
- `readHealthLibraryGraphWithIssues()` records explicit validation issues for those malformed canonical pages and skips them.
- `HealthLibraryGraphIssue` distinguishes validation failures from frontmatter/JSON parse failures.
- Directly coupled query tests cover missing and invalid `slug` / `entityType` behavior for both strict and tolerant readers.
- Required verification, required audit pass, and a scoped commit complete unless an unrelated blocker is named precisely.

## Scope

- In scope:
  - `packages/query/src/health-library.ts`
  - directly coupled `packages/query/test/{health-library,health-internals-coverage}.test.ts`
  - `agent-docs/exec-plans/active/{2026-04-23-query-health-library-validation.md,COORDINATION_LEDGER.md}`
- Out of scope:
  - broader canonical collector behavior outside the library-reader seam
  - contract changes outside the query-local issue/read models
  - unrelated `packages/query` cleanup or refactors

## Constraints

- Keep the change narrow to the reported strict-vs-tolerant validation gap.
- Preserve unrelated dirty-tree edits elsewhere in `packages/query` and the shared ledger.
- Do not weaken the tolerant reader into accepting malformed canonical pages as graph nodes.

## Risks and mitigations

1. Risk: changing strict-reader errors could make existing tolerant parse tests less precise.
   Mitigation: split validation failures into a dedicated issue/error path and keep parse-failure behavior intact.
2. Risk: the tolerant issue surface could stay too vague to diagnose the malformed page.
   Mitigation: include the missing/invalid field in the validation reason and preserve the relative path.
3. Risk: shared query coverage tests may already rely on the old silent-drop behavior.
   Mitigation: update only the directly coupled expectations to assert the new explicit failure/issue semantics.

## Tasks

1. Register the active plan and ledger row.
2. Inspect the current health-library reader/tests and define the validation-failure shape.
3. Implement strict throw plus tolerant issue capture for invalid or missing `slug` / `entityType`.
4. Add directly coupled query regressions for strict and tolerant behavior.
5. Run required verification, the required completion review pass, and land a scoped commit if the shared ledger permits it.

## Decisions

- Model missing/invalid `slug` or `entityType` as query-local validation failures rather than parse failures.
- Keep tolerant parsing additive: malformed canonical pages are still skipped, but never silently.

## Verification

- Planned commands:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/query/src/health-library.ts packages/query/test/health-library.test.ts packages/query/test/health-internals-coverage.test.ts`
  - `pnpm test:smoke`
- Direct proof:
  - Focused query tests for strict rejection and tolerant issue capture on malformed canonical library pages.
