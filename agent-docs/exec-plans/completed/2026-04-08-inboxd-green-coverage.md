# Get packages/inboxd green and above coverage thresholds

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Restore `packages/inboxd` to a green package-local state and lift its package-local coverage back above the enforced thresholds without widening scope beyond the smallest honest fix.

## Success criteria

- `pnpm --dir packages/inboxd test:coverage` passes.
- Required repo verification for `packages/inboxd` passes: `pnpm typecheck`, `pnpm test:packages`, and `pnpm test:smoke`.
- The final change stays narrow, preserves existing unrelated `packages/inboxd` worktree edits, and does not weaken thresholds or shared coverage config.

## Scope

- In scope:
- `packages/inboxd/src/kernel/registry.ts`
- `packages/inboxd/test/**` as needed for focused deterministic coverage additions
- Coordination artifacts for this task (`agent-docs/exec-plans/active/2026-04-08-inboxd-green-coverage.md`, `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`)
- Out of scope:
- Shared/root coverage config changes
- Unrelated `packages/inboxd` source cleanup outside the failing registry/test lane
- Other package coverage lanes already in flight

## Constraints

- Technical constraints:
- Preserve existing uncommitted `packages/inboxd` edits and read current file state before touching adjacent tests.
- Prefer deterministic test additions over production refactors unless a source fix is clearly smaller and safer.
- Product/process constraints:
- Use the repo completion workflow, including a required final audit subagent.
- Create a scoped commit for the touched paths unless a required check fails for a credibly unrelated pre-existing reason.

## Risks and mitigations

1. Risk: Another active inboxd test-cleanup lane is already touching package tests.
   Mitigation: Keep this work limited to the registry coverage lane, reread live files before patching, and preserve adjacent edits if the other lane lands first.
2. Risk: The package-local coverage failure could hide a broader repo verification failure.
   Mitigation: Fix the immediate package-local blocker first, then run the required repo commands for `packages/inboxd` before handoff.

## Tasks

1. Register the active scope in the coordination ledger and keep the plan updated as scope changes.
2. Inspect the `packages/inboxd` package-local coverage failure and identify the exact uncovered registry branches.
3. Add the smallest focused test or source change needed to make the package green above thresholds.
4. Run the required verification commands and capture the exact outcomes.
5. Run the required final audit subagent, address any findings, then close the plan through the scoped commit flow.

## Decisions

- Start from the current package-local coverage failure (`src/kernel/registry.ts` branch coverage) and avoid widening into unrelated inboxd cleanup unless verification proves that scope is necessary.
- Land the repair as a focused test-only change in `packages/inboxd/test/connectors-daemon.test.ts` rather than touching `packages/inboxd/src/kernel/registry.ts` or unrelated dirty inboxd files.

## Verification

- Commands to run:
  - `pnpm --dir packages/inboxd test:coverage`
  - `pnpm typecheck`
  - `pnpm test:packages`
  - `pnpm test:smoke`
- Expected outcomes:
  - `packages/inboxd` package-local coverage is green and above thresholds.
  - The repo-required verification commands for `packages/inboxd` complete successfully.
- Outcomes:
  - `pnpm --dir packages/inboxd test:coverage` passed; `packages/inboxd/src/kernel/registry.ts` branch coverage is now `86.2%`.
  - `pnpm typecheck` passed.
  - `pnpm test:packages` passed.
  - `pnpm test:smoke` passed.
  - Required `task-finish-review` audit completed with no findings in the scoped change.
Completed: 2026-04-08
