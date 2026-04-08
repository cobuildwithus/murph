# Raise `@murphai/contracts` package coverage toward repo-normal gates

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Raise `packages/contracts` package-wide Vitest coverage thresholds from the rollout baseline (`lines 55`, `functions 50`, `branches 45`, `statements 55`) toward roughly 80% without changing runtime behavior.
- Keep the package test surface pure, deterministic, and package-local.

## Success criteria

- `packages/contracts` has enough deterministic test coverage to support materially higher package-wide thresholds.
- New coverage comes primarily from pure helper, registry metadata, schema, example-fixture, and vault-layout seams rather than integration setup.
- Package-local verification passes: typecheck, tests, and package-local coverage.

## Scope

- In scope:
  - package-local tests under `packages/contracts/test/**`
  - package-local threshold updates in `packages/contracts/vitest.config.ts`
- Out of scope:
  - root coverage wiring
  - changes outside `packages/contracts/**`
  - runtime behavior changes

## Current state

- Baseline package-local coverage is `58.17 lines / 51.32 functions / 47.33 branches / 58.10 statements`.
- Existing tests already cover ids/current-profile, frontmatter/validate, time/command-capabilities, and automation/memory/event-lifecycle.
- Largest uncovered package-local seams are registry metadata (`bank-entities.ts`, `health-entities.ts`, `registry-helpers.ts`), vault layout descriptors (`vault-families.ts`, `vault.ts`), schema/example exports (`schemas.ts`, `examples.ts`), and static re-export modules (`index.ts`, `types.ts`).

## Plan

1. Add coverage-heavy pure tests for registry helpers, health/bank entity metadata, and vault-family descriptors.
2. Add schema/example fixture tests that validate exported JSON Schema and example records against the canonical contracts.
3. Add narrow tests for vault metadata validation and public entrypoint/re-export seams.
4. Raise thresholds based on the measured package-local coverage result, keeping any lagging metric justified by evidence.
5. Run package-local verification and a final review-only audit pass.

## Risks and mitigations

1. Risk: chasing 80% with brittle setup-heavy tests.
   Mitigation: prefer exported metadata assertions and contract parsing over fixture orchestration.
2. Risk: overlap with the broader rollout lane.
   Mitigation: keep changes package-local and avoid root config edits.
3. Risk: branch coverage remains lower than line coverage due to large schema-heavy modules.
   Mitigation: target branch-rich pure helpers first and only leave a lower threshold if the final report shows concrete package-local evidence.

## Verification

- Required package-local verification:
  - `pnpm --config.verify-deps-before-run=false --dir packages/contracts typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir packages/contracts test`
  - `pnpm --config.verify-deps-before-run=false --dir packages/contracts test:coverage`
Completed: 2026-04-08
