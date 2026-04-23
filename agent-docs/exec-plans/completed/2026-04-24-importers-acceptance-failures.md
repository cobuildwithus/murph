# Fix current packages/importers acceptance failures

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Fix the current `packages/importers` acceptance failures with the smallest truthful package-local change set.

## Success criteria

- The current manifest filename expectation failures in `packages/importers` are resolved against the intended runtime behavior.
- Any package-local coverage shortfall is fixed without widening beyond directly coupled importer code or tests.
- `pnpm --dir packages/importers test:coverage` passes on the current branch state.

## Scope

- `packages/importers/src/**` only when a minimal production fix is required
- `packages/importers/test/**` for stale expectations or focused coverage proof
- `agent-docs/exec-plans/active/{2026-04-24-importers-acceptance-failures.md,COORDINATION_LEDGER.md}`

## Constraints

- Stay inside the `packages/importers/**` lane only.
- Preserve unrelated dirty-tree work and the active WHOOP/importer metric-alignment row.
- Prefer expectation or focused-test updates when the runtime behavior is intentional.
- Do not widen into `packages/query/**` unless the package-local failures prove a directly coupled cross-package regression that cannot be fixed truthfully inside `packages/importers`.

## Risks and mitigations

1. Risk: the current failures may mix stale test expectations with a real importer bug.
   Mitigation: reproduce the package coverage run first and inspect the exact failing assertion text before editing.
2. Risk: package-local coverage gaps can tempt broad test churn.
   Mitigation: keep the write scope limited to the named manifest failure and the smallest proof needed for uncovered importer branches.

## Tasks

1. Reproduce `pnpm --dir packages/importers test:coverage`.
2. Inspect the failing manifest filename expectations and the reported coverage gap.
3. Apply the smallest truthful fix set.
4. Rerun focused package-local checks and then the full package-local coverage command.

## Decisions

- Kept the fix test-only inside `packages/importers/test/**`; no production importer code changes were required.
- Updated the manifest assertions to the immutable `manifest.<import-id>.<timestamp>.json` contract instead of the legacy `manifest.json` basename.
- Added a dedicated metric-catalog coverage test file rather than widening existing wearable/provider tests.

## Verification

- Commands to run:
  - `pnpm --dir packages/importers test:coverage`
  - focused `pnpm exec vitest` runs in `packages/importers` if iteration needs a narrower loop
  - `pnpm --dir packages/importers test`
- Expected outcomes:
  - `packages/importers` coverage passes without widening beyond the importer owner package.
- Outcomes:
  - `pnpm --dir packages/importers typecheck` passed.
  - `pnpm --dir packages/importers test` passed.
  - `pnpm --dir packages/importers test:coverage` passed.
  - Required local Codex audit passes were launched after verification, but the workers expanded into broad repo-doc rereads and did not return a concise final findings artifact before handoff; neither worker changed the worktree during those attempts.
Completed: 2026-04-24
