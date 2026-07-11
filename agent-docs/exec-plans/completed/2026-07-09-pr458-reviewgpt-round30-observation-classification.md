# PR 458 ReviewGPT Round 30 Observation Classification

## Goal

Fix the accepted ReviewGPT round 30 finding for PR #458: a trusted laboratory Observation category must own classification before overlapping vital LOINC codes are mapped.

Success criteria:

- A laboratory Observation with a scalar vital LOINC is emitted as a diagnostic test, never a vital.
- A laboratory Observation panel with a vital LOINC component is emitted as a diagnostic test, never a vital panel.
- Existing category-less vital exports remain supported.
- Focused tests, typecheck, diff verification, PR CI, and the ReviewGPT loop pass on the pushed head.

## Constraints

- Keep Observation classification and mapping in the existing clinical-records importer owner.
- Reorder the existing lab and vital paths without adding persisted state or a classification framework.
- Preserve raw refs, stable external refs, caps, and atomic panel behavior.

## Current State

- The production-faithful regression proved both scalar and component laboratory Observations were emitted as vitals on the prior implementation.
- Trusted laboratory Observations now route through the existing lab mapper before any vital LOINC matching.
- Focused tests, workspace typecheck, and the full diff-aware verification suite pass.
- Final commit, push, PR CI, and the next ReviewGPT round remain.

## Plan

1. Add scalar and component laboratory fixtures whose LOINC codes overlap the vital allowlist.
2. Prove both fixtures currently emit vital candidates.
3. Route trusted laboratory Observations through the existing lab mapper before vital matching.
4. Run focused package tests, typecheck, `pnpm test:diff`, and hygiene checks.
5. Commit with `scripts/finish-task`, push, and rerun ReviewGPT plus PR CI.

## Verification

- New scalar/component regression before the fix (failed: both candidates were `vitals`)
- `pnpm --dir packages/importers test -- clinical-records.test.ts` (309 passed across 14 files)
- `pnpm typecheck` (passed)
- `env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm test:diff packages/importers/src/clinical-records/index.ts packages/importers/test/clinical-records.test.ts` (passed)
- `git diff --check` (passed)
- Touched-file privacy scan (passed)

Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
