# Make coverage the single repo acceptance lane

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Remove the duplicated repo-acceptance work of requiring both `pnpm test` and `pnpm test:coverage` by making `pnpm test:coverage` the durable acceptance superset, while keeping `pnpm test` available as a faster non-coverage loop.

## Success criteria

- `scripts/workspace-verify.sh test:coverage` runs the same repo guard phases that currently make `pnpm test` distinct from `pnpm test:coverage`.
- Repo workflow docs require `pnpm test:coverage` instead of both commands for the normal acceptance baseline.
- Obvious helper surfaces such as `verify:repo` no longer run both root test commands.
- Required verification is rerun on the final state and any unrelated blockers are recorded precisely.

## Scope

- In scope:
  - `scripts/workspace-verify.sh`
  - root `package.json`
  - `agent-docs/operations/verification-and-runtime.md`
  - `agent-docs/references/testing-ci-map.md`
- Out of scope:
  - Changing app/package-local test commands
  - Removing `pnpm test` as a local developer command
  - Touching unrelated runtime-state, app, or assistant implementation work already active in the tree

## Constraints

- Keep the change small and composable.
- Do not introduce new root scripts.
- Preserve `pnpm test` as a faster non-coverage developer loop even though it stops being a required acceptance command.

## Risks and mitigations

1. Risk: Switching acceptance to coverage-only could drop repo guard checks that previously only lived in `pnpm test`.
   Mitigation: Move the missing dependency/workspace guard phases into `run_test_coverage`.
2. Risk: Docs could drift from the actual command behavior.
   Mitigation: Update the durable verification docs and root helper script surfaces in the same change.
3. Risk: The existing dirty tree could block repo-wide verification for unrelated reasons.
   Mitigation: Record the exact failing command and targets if that happens, while keeping the commit scope narrow.

## Tasks

1. Patch `scripts/workspace-verify.sh` so `test:coverage` includes the same repo guard phases as `test`.
2. Update root helper wiring and docs so repo acceptance requires `pnpm test:coverage` rather than both root test commands.
3. Run the required final verification and commit only the scoped workflow/tooling files.

## Decisions

- Keep `pnpm test` as the quicker non-coverage loop for local iteration.
- Make `pnpm test:coverage` the single durable repo acceptance lane.

## Verification

- Commands to run:
  - `bash -n scripts/workspace-verify.sh`
  - `pnpm typecheck`
  - `pnpm test:coverage`
- Expected outcomes:
  - Script syntax passes.
  - `pnpm typecheck` passes or fails only for unrelated dirty-tree reasons outside this workflow lane.
  - `pnpm test:coverage` either passes or fails only for unrelated dirty-tree reasons outside this workflow lane, with the failing targets called out explicitly.
- Outcomes:
  - `bash -n scripts/workspace-verify.sh`: passed.
  - `pnpm typecheck`: failed in the unrelated active dirty-tree `packages/hosted-execution/src/parsers.ts` lane during the workspace build, with missing/renamed hosted-execution bundle exports and properties outside this workflow change.
  - `pnpm test:coverage`: failed in the same unrelated active dirty-tree hosted-execution lane during `build:test-runtime:prepared`, but the command now visibly runs `Dependency policy` and `Workspace boundary checks` before doc gardening and the coverage/runtime path, confirming the intended superset wiring change.
Completed: 2026-04-06
