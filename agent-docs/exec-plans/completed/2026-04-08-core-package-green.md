# Get `packages/core` green and above package-local coverage thresholds

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Make `packages/core` pass its package-local verification and coverage gates.
- Keep the fix isolated to `packages/core/**` plus the required workflow metadata.

## Success criteria

- `pnpm --dir packages/core typecheck` passes.
- `pnpm --dir packages/core test` passes.
- `pnpm --dir packages/core test:coverage` passes.
- Any added or changed tests are deterministic and reflect existing core behavior rather than weakening thresholds.

## Scope

- In scope:
- `packages/core/**`
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-core-package-green.md}`
- Out of scope:
- repo-wide coverage configuration changes unless an honest `packages/core` fix cannot land without one
- unrelated package coverage work already in flight elsewhere in the tree

## Current state

- `packages/core` now has targeted source and test changes that make package-local verification pass.
- The repo is otherwise dirty, with other active coverage and hosted-web lanes already in progress.
- Mixed protocol read selectors now reject the same conflict that protocol upserts already rejected.
- Package-local verification is green:
  - `pnpm --dir packages/core typecheck`
  - `pnpm --dir packages/core test`
  - `pnpm --dir packages/core test:coverage`

## Risks and mitigations

1. Risk:
   `packages/core` failures are caused by adjacent workspace changes rather than the package itself.
   Mitigation:
   Start with package-local runs and keep evidence for whether the break is local or upstream.
2. Risk:
   Coverage gaps tempt broad source edits.
   Mitigation:
   Prefer focused deterministic tests first, and only change source when the existing behavior is genuinely hard to exercise or incorrect.
3. Risk:
   Overlap with the broader package-coverage cleanup task causes avoidable conflicts.
   Mitigation:
   Keep this lane limited to `packages/core/**` and the workflow files, and preserve any unrelated worktree edits.

## Tasks

1. Baseline `packages/core` with package-local typecheck, tests, and coverage.
2. Identify the concrete failing tests and uncovered files/branches.
3. Split the work across parallel subagents where that shortens the loop.
4. Implement the minimal truthful fixes.
5. Re-run package-local verification and the required final audit.
6. Finish with a scoped commit.

## Verification

- `pnpm --dir packages/core typecheck`
- `pnpm --dir packages/core test`
- `pnpm --dir packages/core test:coverage`
Completed: 2026-04-08
