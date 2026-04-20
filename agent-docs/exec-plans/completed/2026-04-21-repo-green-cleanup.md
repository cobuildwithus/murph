# Repo green cleanup

Status: completed
Created: 2026-04-21
Updated: 2026-04-21

## Goal

- Get the current dirty tree to a truthful green acceptance baseline and leave the repo fully committed and clean.

## Success criteria

- `pnpm verify:acceptance` passes on the current tree.
- Any additional repo checks needed to validate the remaining dirty lanes are green.
- The remaining worktree changes are committed in scoped commits with their matching active-plan artifacts closed where applicable.
- `git status --short` is empty at handoff.

## Scope

- Focused test/proof fixes needed to clear current acceptance failures.
- Minimal plan/ledger cleanup needed to commit the in-flight dirty lanes cleanly.
- No speculative product changes beyond what the current dirty tree already intends.

## Constraints

- Preserve unrelated dirty-tree edits while stabilizing verification.
- Prefer test-only or proof-only fixes when the failure is coverage or verification drift.
- Keep commit structure aligned with the existing active plan rows where practical.

## Verification

- planned: `pnpm verify:acceptance`
- planned: any narrower owner coverage reruns needed while iterating
- planned: `git status --short`

## Notes

- Current acceptance failures are package-coverage threshold misses in `assistant-engine`, `assistant-runtime`, `hosted-execution`, `query`, and `runtime-state`.
Completed: 2026-04-21
