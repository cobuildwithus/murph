# Get repo checks fully green

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Restore the repository to a state where the required acceptance checks are green again on the current branch, with fixes kept scoped to the concrete failures surfaced by the baseline verification run.

## Success criteria

- `pnpm typecheck` completes successfully.
- `pnpm test:coverage` completes successfully.
- Any intermediate targeted checks used to fix failures also pass for the touched surface.
- The final diff preserves unrelated in-flight work and is committed with the required workflow artifacts.

## Scope

- In scope:
- Current failures surfaced by `pnpm typecheck` and `pnpm test:coverage`.
- Narrow supporting test or doc updates required to make those checks pass truthfully.
- Required workflow artifacts for a plan-bearing repo task, including coordination, review, verification, and scoped commit handling.
- Out of scope:
- Unrelated cleanup or refactors outside the failing verification surface.
- Rewriting overlapping active lanes unless a failing check proves a boundary change is required.

## Constraints

- Technical constraints:
- Preserve unrelated dirty worktree edits and overlapping active lanes already registered in the coordination ledger.
- Re-read overlapping files immediately before editing and keep fixes contract-safe instead of masking errors.
- Avoid destructive git cleanup; commit only the exact touched paths.
- Product/process constraints:
- Follow the repo completion workflow, including the required audit subagent pass, re-running checks after fixes, and closing the plan before final commit/handoff.

## Risks and mitigations

1. Risk: Repo-wide failures may come from multiple active lanes with overlapping files.
   Mitigation: Triage from actual failing commands, stay scoped to the failing surfaces, and re-read live file state before each edit.
2. Risk: A local fix could make one check pass while breaking the broader acceptance lane.
   Mitigation: Re-run targeted checks during repair, then finish with the full required baseline.

## Tasks

1. Run the required baseline commands and capture the current failures.
2. Classify the failing surfaces and apply the smallest defensible fixes.
3. Re-run targeted commands until each repaired surface is green.
4. Re-run `pnpm typecheck` and `pnpm test:coverage`.
5. Run the required final review pass, address any findings, then close the plan and commit the touched paths.

## Decisions

- Start from the repo’s required acceptance commands instead of trying to infer failure hotspots from the dirty worktree alone.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:coverage`
- Additional focused commands as needed for repaired surfaces
- Expected outcomes:
- The required repo acceptance checks finish green and any focused repair commands corroborate the touched changes.
Completed: 2026-04-07
