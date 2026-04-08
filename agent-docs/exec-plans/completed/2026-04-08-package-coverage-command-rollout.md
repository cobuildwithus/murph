# Package Coverage Command Rollout

Last updated: 2026-04-08

## Goal

Add explicit package-local `test:coverage` scripts only to the owned package manifests that already have honest package-local Vitest coverage wiring, then run those package-local coverage commands and report the results.

## Scope

- Allowed edits: `packages/{assistant-runtime,assistantd,core,hosted-execution,importers,query}/package.json`
- Read-only assessment: `packages/{parsers,runtime-state,inbox-services,vault-usecases}`
- Preserve unrelated dirty worktree edits and avoid any `vitest.config.ts` or other-file changes unless an unavoidable blocker appears.

## Success Criteria

- Each edited package manifest exposes `test:coverage` as a package-local command that actually runs its existing Vitest coverage config.
- No edits land in packages that still lack honest package-local coverage wiring.
- Final handoff includes exact commands/results and calls out any packages that still need separate coverage wiring.

## Constraints / Risks

- Other agents already have overlapping coverage work in this repo; stay manifest-only and read current file state first.
- `parsers` and `runtime-state` must not get misleading coverage scripts if they still lack package-local coverage config.
- `inbox-services` and `vault-usecases` are assessment-only in this lane.

## Verification Plan

- `pnpm typecheck`
- `pnpm --dir packages/<pkg> test:coverage` for each newly wired owned package, if feasible

## Notes

- This is a narrow rollout lane under the broader repo package-coverage effort, but it remains scoped to the manifests listed above.
Status: completed
Updated: 2026-04-08
Completed: 2026-04-08
