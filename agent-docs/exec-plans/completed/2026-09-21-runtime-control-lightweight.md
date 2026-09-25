# Keep orchestration contracts dependency-light

Status: completed
Created: 2026-09-21
Updated: 2026-09-21

## Goal and scope

Restore the lightweight public orchestration import graph without changing mailbox
validation, processing modes, workflow bundle budgets, or execution behavior.
Prepare the five public release manifests and CLI release notes for version 1.3.5.
Publishing and deployment remain with the parent completion owner.

## Design

The orchestration entrypoint loaded runtime-control for processing-mode constants;
runtime-control now reaches health schemas through vault-sharing helpers. Extract
only mailbox lane and processing-mode values into a dependency-free internal leaf.
Keep existing runtime-control exports and expose the lane predicate through the
existing orchestration-control entrypoint. Type-only runtime contracts remain
available without entering the emitted JavaScript graph. No new package subpath,
private schema copy, dependency, persisted state, or budget exemption is needed.

## Verification and outcome

- `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage test/orchestration-control-dependencies.test.ts test/hosted-execution.test.ts test/hosted-orchestration-control.test.ts test/hosted-runtime-control.test.ts test/temporal-env.test.ts`: 96 passed.
- `pnpm --dir packages/hosted-execution test:coverage`: 777 passed, one existing skipped test; statements 83.11%, branches 76.94%.
- `pnpm --dir packages/hosted-execution typecheck` and `pnpm --dir packages/hosted-execution build`: passed.
- Independent Node module-loader proof against emitted orchestration-control:
  only orchestration-control.js, runtime-control-values.js and
  reconciliation-facts-wire.js loaded. Runtime execution, vault-sharing,
  contracts and external modules were forbidden. Type-only imports were erased.
- `pnpm test:scenario-integrity`: passed for 205 scenarios, 12 inputs and 29 golden-output directories.
- `pnpm complexity:diff`: passed; only a function move, no complexity increase.
  The pre-existing runtime timing hotspot is unchanged and outside scope.
- `node scripts/verify-release-target.mjs --expect-version 1.3.5`: all five public packages and release notes validated.
- `pnpm install --lockfile-only --offline`: lockfile unchanged; only shared package versions changed, with no dependency resolution changes.
- `bash scripts/check-agent-docs-drift.sh` and `git diff --check`: passed.
- Full diff, new files and Frog entry reviewed for privacy and scope.
- The private consumer must import the lane predicate from orchestration-control
  and pin the published release before its unchanged workflow bundle gate passes.
- Product UX: Ready for this internal packaging repair; mailbox validation and workflow decisions
  remain identical. No live-model journey is required for this import-only change.
- Changelog: no member-facing Web entry because behavior is unchanged. CLI release
  notes describe the package boundary repair.
Completed: 2026-09-21
