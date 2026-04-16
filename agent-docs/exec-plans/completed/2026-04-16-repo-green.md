## Goal

Get the repository fully green after the cleanup/commit pass.

## Why

- The worktree is clean, but `pnpm typecheck` still fails on missing Next route/page stub imports.
- `apps/cloudflare/test/container-entrypoint.test.ts` hangs instead of returning a normal result.

## Scope

- `apps/web/**` only as needed to resolve generated type stub failures
- `scripts/ensure-next-route-type-stubs.ts` if the stub generation logic is wrong
- `apps/cloudflare/test/container-entrypoint.test.ts` and related runtime/test helpers if needed to stop the hang

## Constraints

- Keep fixes minimal and focused on repo-green verification blockers.
- Do not re-open unrelated committed slices.

## Verification

- `pnpm typecheck`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --maxWorkers=1 apps/cloudflare/test/container-entrypoint.test.ts`
- final clean `git status --short`
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
