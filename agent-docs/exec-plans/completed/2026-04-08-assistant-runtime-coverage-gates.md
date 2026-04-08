# Raise `@murphai/assistant-runtime` per-file coverage gates toward repo-normal thresholds

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Raise `packages/assistant-runtime` coverage thresholds from the rollout values toward repo-normal package gates, aiming for about 80% lines/statements with stronger function coverage and a materially improved branch floor.
- Keep the package API and hosted runtime behavior unchanged.

## Success criteria

- Low-coverage seams in `packages/assistant-runtime/src/**` have focused package-local tests rather than broader runtime rewrites.
- Shared package-local test helpers reduce repeated hosted-runtime stub setup where new tests need the same platform/effects fixtures.
- `packages/assistant-runtime/vitest.config.ts` reflects stronger thresholds that the package can now support with evidence.
- Package-local verification covers typecheck, tests, and a coverage run.

## Scope

- In scope:
- `packages/assistant-runtime/**`
- package-local shared helpers under `packages/assistant-runtime/test/**`
- active plan and coordination-ledger bookkeeping for this package lane
- Out of scope:
- root `vitest.config.ts`
- `config/**`
- other packages and root verification scripts

## Current state

- Current package-local coverage is `84.72 statements / 67.4 branches / 96.15 functions / 84.6 lines`.
- Current thresholds are `65 lines / 83 functions / 53 branches / 65 statements` with `perFile: true`.
- The weakest files are `src/hosted-runtime/callbacks.ts`, `src/hosted-runtime/summary.ts`, `src/hosted-device-sync-runtime.ts`, and a few in-process hosted-runner branches in `src/hosted-runtime.ts`.

## Risks and mitigations

1. Risk: chasing thresholds by excluding files or changing runtime behavior.
   Mitigation: keep the include pattern as-is and add behavior-level tests only.
2. Risk: repeated bespoke test stubs make the package harder to maintain.
   Mitigation: extend the existing package-local hosted-runtime helper file when multiple tests need the same stub shape.
3. Risk: branch coverage still lags lines/functions in callback and device-sync code.
   Mitigation: target missing error/no-op/reconciliation branches first and only set the final branch threshold to a value supported by measured results.

## Tasks

1. Confirm the current package-local coverage gaps and identify the lowest per-file seams.
2. Spawn package-scoped GPT-5.4 `medium` subagents for disjoint hosted-runtime seams.
3. Integrate the resulting tests/helper additions locally.
4. Raise package-local thresholds to the strongest values supported by the measured coverage.
5. Run package-local typecheck, tests, coverage, and the required final review pass.

## Decisions

- Keep the work package-local and report any root integration follow-up instead of editing root coverage wiring here.
- Prefer one shared hosted-runtime helper module over repeated inline effects-port setup.
- Treat branch coverage as the likely trailing metric and justify any final branch floor that still lands below 80.

## Verification

- Required commands:
  - `pnpm --config.verify-deps-before-run=false --dir packages/assistant-runtime typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir packages/assistant-runtime test`
  - `pnpm --config.verify-deps-before-run=false --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --coverage`
Completed: 2026-04-08
