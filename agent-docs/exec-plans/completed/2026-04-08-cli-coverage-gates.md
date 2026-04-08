# Raise `@murphai/murph` package-wide coverage gates toward repo-normal thresholds

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Raise `packages/cli` coverage thresholds from the current rollout values toward repo-normal package gates, with better function and branch coverage across real CLI command seams.
- Keep the existing six-bucket Vitest workspace structure intact unless a package-local change is clearly necessary.

## Success criteria

- The weakest package-local command/runtime seams gain focused tests without broad harness churn.
- New coverage reuses existing CLI helpers such as `runInProcessJsonCli`, `createTempVaultContext`, and the prepared-runtime expectations instead of creating a second harness stack.
- `packages/cli/vitest.workspace.ts` reflects stronger thresholds supported by measured coverage.
- Package-local verification covers typecheck, the focused CLI verify flow, and a package-local coverage run.

## Scope

- In scope:
- `packages/cli/**`
- package-local shared helpers under `packages/cli/test/**`
- active plan and coordination-ledger bookkeeping for this package lane
- Out of scope:
- root `vitest.config.ts`
- `config/**`
- `scripts/workspace-verify.sh`
- other packages and root coverage wiring

## Current state

- Current measured package-local coverage is `80.46 statements / 56.05 branches / 70.72 functions / 80.62 lines`.
- Current thresholds are `80 lines / 70 functions / 55 branches / 80 statements`.
- The largest remaining seams are command/runtime paths in `src/review-gpt-runtime.ts`, `src/commands/{device,knowledge,document,supplement,workout}.ts`, plus branch-heavy portions of `src/commands/{model,inbox}.ts`.
- The prepared build lane is currently blocked by unrelated `packages/assistantd/src/service.ts` type errors, so package-local verification should prefer the existing prepared-artifact path with explicit blocker reporting if that broader lane stays red.

## Risks and mitigations

1. Risk: coverage work spills into root or sibling package wiring.
   Mitigation: keep the lane package-local and report any root follow-up instead of editing shared config here.
2. Risk: bespoke CLI harness code duplicates existing helpers.
   Mitigation: reuse `runInProcessJsonCli` and add only narrow test-local helpers when multiple new tests need the same stub shape.
3. Risk: branch coverage remains the trailing metric because several command files are option-routing heavy.
   Mitigation: target run-path and error-branch coverage in command modules first, then set the final branch threshold only to the highest measured value the package can defend.

## Tasks

1. Confirm the package-local coverage gaps and identify the lowest-value command/runtime seams.
2. Spawn package-scoped GPT-5.4 `medium` subagents for disjoint CLI seams.
3. Integrate the resulting package-local tests and any helper additions.
4. Raise `packages/cli/vitest.workspace.ts` thresholds to the strongest values supported by measured coverage.
5. Run package-local typecheck, focused CLI verification, a coverage run, and the required final review pass.

## Decisions

- Keep the existing Vitest workspace bucket structure and only add new test files into an appropriate existing bucket.
- Bias toward in-process command tests for device and knowledge seams because the sandbox blocks loopback listener setup in at least one existing device test.
- Treat function and branch coverage as the primary threshold-improvement targets; lines/statements should rise incidentally from the same tests.

## Verification

- Required commands:
  - `pnpm --config.verify-deps-before-run=false --dir packages/cli typecheck`
  - `pnpm --config.verify-deps-before-run=false verify:cli`
  - `MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm --config.verify-deps-before-run=false exec vitest run --config packages/cli/vitest.workspace.ts --coverage`
