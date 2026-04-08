# CLI Standalone Coverage

## Goal

Raise `packages/cli` standalone coverage toward an honest package-local gate near repo norms, while keeping the diff scoped to existing CLI behavior and tests.

## Scope

- `packages/cli/**`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Constraints

- Do not broaden CLI product surface just to gain coverage.
- Avoid runner-vault or foreground terminal logging drift.
- Prefer focused tests and minimal coverage-config changes.
- Preserve unrelated dirty `packages/cli` edits.
- Required package-local verification should stay within the strongest safe scoped lane if broader commands are already red for unrelated reasons.

## Plan

1. Inspect current `packages/cli` tests, coverage config, and dirty worktree state.
2. Identify the highest-value uncovered seams and delegate bounded discovery/implementation checks to GPT-5.4 medium subagents.
3. Add package-local tests and only the smallest coverage-config adjustment if coverage proof shows it is necessary.
4. Run `packages/cli` typecheck/test/coverage verification, isolate unrelated blockers if they remain, and document exact thresholds/results.
5. Run required final audit review, then commit only the scoped touched files if the lane is safe to land.
Status: completed
Updated: 2026-04-08
Completed: 2026-04-08
