# Repo Verification Green

## Goal

Get the current repo verification lane green by fixing the narrow failing check rather than masking failures or broadening infrastructure.

## Scope

- Investigate the current CLI/core verification failure around canonical vault write locks.
- Patch only the minimal owner-local code or test contract needed to make the verification lane deterministic.
- Preserve unrelated dirty work and active plan rows.

## Non-Goals

- No branch/worktree changes.
- No broad lock redesign unless static and runtime evidence proves the existing primitive is wrong.
- No cleanup of unrelated active DeepSec or hosted-runner work.

## Verification

- Reproduce the failing package/test lane.
- Run the focused affected test.
- Run `pnpm typecheck`.
- Run `pnpm test:diff` or the closest truthful scoped lane for this task.
- Run broader repo acceptance if the focused gates are green and time/resources allow.

## Current State

- Fixed the current red signal by keeping inbox promotion locks on the same core runtime port used for nested canonical writes.
- Focused CLI reproducer, inbox-services tests, CLI tests, typecheck, diff check, diff-aware repo verification, and full acceptance all pass.
- Required security/privacy, coverage-write, and final completion audit passes reported no findings.
- Safe scoped commit is blocked because this task's fix overlaps files already dirty for the active DeepSec row; archive the plan without committing unrelated work.
Status: completed
Updated: 2026-05-24
Completed: 2026-05-24
