# PR 458 ReviewGPT Round 31 Allergy And Rate Boundaries

## Goal

Fix the two accepted ReviewGPT round 31 findings for PR #458: raw allergy-coded Condition evidence must block unsafe global no-known-allergies assertions, and supported rate vitals must accept common UCUM `/min` quantities.

Success criteria:

- A no-known-allergies assertion is not emitted when the same retrieval contains a conservatively identifiable allergy Condition.
- Condition resources remain raw-only and unsupported; no Condition import path is added.
- Heart-rate and respiratory-rate Observations using UCUM `/min` emit canonical vital units.
- Focused tests, typecheck, diff verification, PR CI, and the ReviewGPT loop pass on the pushed head.

## Constraints

- Extend the existing pre-import allergy conflict scan rather than the canonical mapper.
- Recognize Condition allergy evidence conservatively from a trusted SNOMED code or explicit allergy/hypersensitivity concept text.
- Add only facet-local unit aliases; do not loosen UCUM system validation.
- Add no persisted state, terminology service, or Condition registry.

## Current State

- Production-faithful regressions proved that allergy-coded Condition evidence did not block NKDA and UCUM `/min` rate vitals were rejected.
- The existing conflict scan now recognizes conservative Condition allergy evidence, and facet-local aliases normalize supported rate units.
- Focused importer tests and workspace typecheck pass.
- The full diff-aware run is blocked by a repeated unrelated assistant-CLI startup-import timeout under concurrent machine load; the same 128-test package passes in isolation.
- Final commit, push, PR CI, and the next ReviewGPT round remain.

## Plan

1. Add failing regressions for NKDA plus an allergy-coded Condition and for UCUM `/min` heart/respiratory rates.
2. Extend the existing allergy conflict predicate for conservative Condition evidence.
3. Add facet-specific rate-unit aliases that preserve the existing canonical units.
4. Run focused package tests, typecheck, `pnpm test:diff`, and hygiene checks.
5. Commit with `scripts/finish-task`, push, and rerun ReviewGPT plus PR CI.

## Verification

- New allergy and rate regressions before the fix (failed on both reported behaviors)
- `pnpm --dir packages/importers test -- clinical-records.test.ts` (311 passed across 14 files)
- `pnpm typecheck` (passed)
- `pnpm --dir packages/assistant-cli test -- assistant-command-startup-imports.test.ts` (128 passed across 22 files)
- `env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm test:diff packages/importers/src/clinical-records/index.ts packages/importers/test/clinical-records.test.ts` (attempted twice; blocked only by unchanged assistant-CLI startup-import tests timing out at 30 seconds under concurrent machine load)
- `git diff --check` (passed)
- Touched-file privacy scan (passed)

Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
