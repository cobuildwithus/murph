# Cloudflare Verify Speed

## Goal

Reduce the `Run focused Cloudflare checks` wall time in the Cloudflare deploy workflow by about 40% without dropping the standalone `apps/cloudflare verify` coverage that repo acceptance expects.

## Constraints

- Keep production/runtime behavior unchanged.
- Preserve the full app-local verify lane for ordinary package verification.
- In deploy, only skip or overlap work when an earlier deploy step has already provided equivalent proof.
- Preserve unrelated dirty worktree edits and active coordination rows.

## Scope

- `apps/cloudflare/test/runner-container.test.ts`
- Direct docs/tests/config only if the check contract changes materially

## Verification

- Time current and updated `pnpm --dir apps/cloudflare verify:parallel` behavior where feasible.
- Run the focused Cloudflare verify command affected by the script change.
- Run direct shell syntax checks and `git diff --check`.

## State

- Deploy run `24879770648` spent about 88 seconds in `Run focused Cloudflare checks`.
- The deploy workflow already builds the Cloudflare runner workspace closure during `Prepare deploy artifacts` before running `apps/cloudflare verify:parallel`.
- Local CI-shaped Node Vitest timing improved from `44.61s` to `29.08s` by enabling file-level parallelism with app workers at `100%`.
- Full file-level parallelism exposed Node-suite fixture collisions, so that path is rejected.
- The slowest stable target is `runner-container.test.ts`; real destroy-timeout waits account for about 25 seconds of local CI-shaped Node runtime.
- Finish review rejected the deploy typecheck skip because `deploy:artifacts` does not cover the full app typecheck surface.
- Implementation now keeps the deploy app typecheck intact and converts destroy-timeout assertions to fake timers instead of widening Vitest file parallelism.
- After the test change, local CI-shaped `apps/cloudflare test:node` improved from `44.61s` to `18.21s`.
- Local CI-shaped `apps/cloudflare verify:parallel` with typecheck intact now runs in `18.67s`; the pre-change component baseline was about `47.79s`.
Status: completed
Updated: 2026-04-24
Completed: 2026-04-24
