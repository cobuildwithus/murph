# Assistant-engine package coverage readiness

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Make `@murphai/assistant-engine` ready for root coverage expansion by adding package-local coverage config and high-value tests across the seams that can be honestly gated in this pass.

## Success criteria

- `packages/assistant-engine` has package-local Vitest coverage config in the repo's existing package style, with seam-scoped include patterns that match the files verified in this pass.
- New tests cover the highest-value assistant-engine seams without changing package behavior or API shape.
- Shared package-local helpers are reused where they reduce duplication.
- Package-local verification passes, and any required root integration is called out explicitly instead of being edited here.

## Scope

- In scope:
  - `packages/assistant-engine/**`
  - package-local `vitest.config.ts` coverage configuration if needed
  - package-local tests and shared test helpers under `packages/assistant-engine/test/**`
- Out of scope:
  - root `vitest.config.ts` or `config/**`
  - other packages
  - behavior refactors unrelated to coverage readiness

## Constraints

- Preserve unrelated dirty assistant-engine edits already in the worktree.
- Reuse existing helper patterns before adding new harnesses.
- Keep subagent write ownership disjoint by seam.
- Do not commit for this task.

## Risks and mitigations

1. Risk: broad assistant-engine surface leads to scattered low-value tests.
   Mitigation: inventory seams first, then prioritize runtime/store/provider/knowledge boundaries with reusable setup.
2. Risk: overlap with active assistant-engine edits causes conflicts.
   Mitigation: read current file state first, keep package-local scope narrow, and avoid unrelated refactors.
3. Risk: package-local helpers sprawl.
   Mitigation: prefer one small shared helper layer under `packages/assistant-engine/test/**` rather than per-test bespoke setup.

## Tasks

1. Inspect package config, existing tests, and source seams.
2. Compare sibling package coverage-config patterns.
3. Publish a package plan in commentary covering coverage config, seam priorities, helper reuse, and subagent split.
4. Add package-local coverage config and shared helpers as needed.
5. Spawn GPT-5.4 high subagents for disjoint assistant-engine seams.
6. Integrate subagent diffs, run package-local verification, and report root-integration guidance.

## Decisions

- A full package-local `src/**/*.ts` coverage gate is not yet credible for assistant-engine; keep the package-local coverage include list limited to the seams that now clear the repo thresholds:
  - `src/assistant/failover.ts`
  - `src/assistant/state-write-lock.ts`
  - `src/assistant/store/paths.ts`
  - `src/assistant/outbox/intents.ts`
  - `src/assistant/web-search/{config,search}.ts`
  - `src/knowledge/documents.ts`
- Additional tests for `assistant-cli-access`, lock-wrapper interactions, `knowledge/service`, and `web-search` result parsing remain valuable readiness groundwork, but they are not part of the current per-file coverage gate.
- The pre-existing package test failure from missing workout façade imports was resolved by restoring thin package-local usecase re-export shims during the turn.

## Verification

- Commands to run:
  - `node ../../node_modules/typescript/bin/tsc -p tsconfig.typecheck.json --pretty false`
  - `node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts --no-coverage`
  - `node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts --coverage`
- Expected outcomes:
  - assistant-engine package-local verification passes and the package is ready for root coverage expansion with the same seam-scoped include patterns.
Completed: 2026-04-08
