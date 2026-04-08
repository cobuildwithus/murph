# Get `packages/query` green and above package-local coverage thresholds

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Make `packages/query` pass its package-local verification and coverage gates.
- Keep the fix isolated to `packages/query/**` plus the required workflow metadata.

## Success criteria

- `pnpm --dir packages/query typecheck` passes.
- `pnpm --dir packages/query test` passes.
- `pnpm --dir packages/query test:coverage` passes.
- Any added or changed tests are deterministic and reflect existing query behavior rather than weakening thresholds.

## Scope

- In scope:
- `packages/query/**`
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-query-package-green.md}`
- Out of scope:
- repo-wide coverage configuration changes unless an honest `packages/query` fix cannot land without one
- unrelated package coverage work already in flight elsewhere in the tree

## Current state

- `packages/query` is green at the package level with deterministic added coverage tests.
- The repo is otherwise dirty, with other active coverage and hosted-web lanes already in progress.
- Repo-wide verification remains red in unrelated packages outside this lane.

## Risks and mitigations

1. Risk:
   `packages/query` failures are caused by adjacent workspace changes rather than the package itself.
   Mitigation:
   Start with package-local runs and keep evidence for whether the break is local or upstream.
2. Risk:
   Coverage gaps tempt broad source edits.
   Mitigation:
   Prefer focused deterministic tests first, and only change source when the existing behavior is genuinely hard to exercise or incorrect.
3. Risk:
   Overlap with the broader package-coverage cleanup task causes avoidable conflicts.
   Mitigation:
   Keep this lane limited to `packages/query/**` and the workflow files, and preserve any unrelated worktree edits.

## Tasks

1. Baseline `packages/query` with package-local typecheck, tests, and coverage.
2. Identify the concrete failing tests and uncovered files/branches.
3. Split the work across parallel subagents where that shortens the loop.
4. Implement the minimal truthful fixes.
5. Re-run package-local verification and the required final audit.
6. Finish with a scoped commit.

## Verification

- `pnpm --dir packages/query typecheck`
- `pnpm --dir packages/query test`
- `pnpm --dir packages/query test:coverage`
- `pnpm typecheck` -> fails outside this lane in `packages/{vault-usecases,assistant-engine,inbox-services,cli}` and during workspace build expectations for `packages/query/dist`
- `pnpm test:smoke`
- `pnpm test:packages` -> produced unrelated repo failures/hangs outside this lane, including `packages/{assistantd,core,importers}` and interactive setup/CLI flows
Completed: 2026-04-08
