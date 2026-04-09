# Typecheck Coverage Tsconfigs

## Goal

Make the package/app-local `typecheck` lane compile every intended TypeScript source, test, and root config file without falling over on build-only `rootDir` assumptions.

## Success Criteria

- `pnpm typecheck` passes with the package/app-local no-emit lane enabled.
- Package/app typecheck configs cover the repo's intended `.ts` and `.tsx` files instead of leaving real source or test files outside the lane.
- Build-shaped configs keep their emit-oriented `rootDir` settings; typecheck-only coverage is handled through dedicated no-emit configs where needed.
- The final diff stays limited to typecheck script/config wiring and any minimal follow-up fixes required by the now-covered files.

## Constraints

- Preserve unrelated in-flight worktree edits.
- Do not change the semantic contract back to a full workspace emit build inside `pnpm typecheck`.
- Prefer typecheck-only config fixes over broad source refactors unless the newly covered files expose a real compiler bug that must be fixed.

## Current Scope

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-09-typecheck-coverage-tsconfigs.md`
- `packages/*/{package.json,tsconfig*.json}`
- `apps/{web,cloudflare}/{package.json,tsconfig*.json}`

## Verification

- `pnpm typecheck`
- Direct TypeScript coverage audit over package/app typecheck entrypoints

## Planned Steps

1. Reconcile the current in-progress typecheck config edits and patch the remaining structural `rootDir` / script issues.
2. Run `pnpm typecheck`, then fix any real newly surfaced errors in the now-covered files.
3. Re-run the coverage audit, complete the required final review pass, and commit the scoped change set.

Status: completed
Updated: 2026-04-09
Completed: 2026-04-09
