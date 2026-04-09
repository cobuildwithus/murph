# Clean coordination ledger and restore full green verification

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Clean the stale coordination ledger, repair the current repo verification blockers on top of the existing worktree, and return the branch to a truthful green `pnpm verify:acceptance`.

## Success criteria

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` reflects only the live work for this task.
- The current dirty worktree changes needed for this task are coherent and minimal.
- `pnpm typecheck` passes.
- `pnpm verify:acceptance` passes.
- Required audit subagent passes are completed and any resulting fixes are re-verified.

## Scope

- In scope:
  - Cleaning stale active-work rows from the coordination ledger.
  - Repairing the currently exposed repo verification failures needed to restore a green acceptance lane.
  - Updating the active plan and ledger as the task evolves.
- Out of scope:
  - Unrelated refactors or abandoned task recovery outside what the acceptance lane proves is needed.

## Constraints

- Technical constraints:
  - Preserve unrelated worktree edits and avoid reverting user or concurrent-agent changes.
  - Use the repo-required audit workflow with subagents before handoff.
- Product/process constraints:
  - Finish with the repo baseline checks, not only scoped local checks, unless an unrelated blocker is proven.
  - Commit only the exact touched paths via the repo commit helper.

## Risks and mitigations

1. Risk: The worktree already contains uncommitted edits from prior attempts, so a naive cleanup could drop needed fixes or overwrite unrelated work.
   Mitigation: Reproduce failures first, keep the ledger narrow, and only edit files tied to the reproduced blockers.

2. Risk: Additional red packages may surface later in `pnpm verify:acceptance`.
   Mitigation: Keep the full acceptance lane running and split newly exposed failures into bounded follow-up fixes.

## Tasks

1. Replace the stale ledger state with one live row for this task and keep the plan current.
2. Reproduce the current verification failures with `pnpm typecheck` and `pnpm verify:acceptance`.
3. Fix each exposed blocker with the smallest safe diff, using subagents for independent lanes where useful.
4. Re-run the required verification and audit passes until the repo is green.
5. Finish the plan-bearing task with a scoped commit.

## Decisions

- Use `pnpm verify:acceptance` as the end-state gate for this task.
- Treat the existing stale ledger rows as cleanup residue because there are no matching active plans in `agent-docs/exec-plans/active/`.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm verify:acceptance`
  - Narrower package commands used during local iteration for reproduced failures
- Expected outcomes:
  - All commands above pass on the final tree.
- Outcomes recorded:
  - `pnpm typecheck` passed, including a final rerun after the audit follow-up.
  - `pnpm --dir packages/operator-config test:coverage` passed after adding `packages/operator-config/test/vault-cli-contracts.test.ts`.
  - `pnpm verify:acceptance` passed on the task diff, including the final rerun after the audit follow-up.
  - Required audit subagent passes completed: `coverage-write` found no additional proof gap; `task-finish-review` found one medium-severity ledger-scope accuracy issue, fixed locally in the active ledger.
Completed: 2026-04-09
