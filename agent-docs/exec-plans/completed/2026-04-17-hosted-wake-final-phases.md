## Goal

Land the remaining applicable HostedWake cutover phases from the returned patch without broadening beyond the intended hosted wake ownership cleanup.

## Scope

- `apps/cloudflare/src/hosted-email/worker-ingress.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-wake-state.ts`
- `apps/cloudflare/src/web-control-plane.ts`
- `apps/cloudflare/test/**`
- `apps/web/app/api/internal/hosted-wake/**`
- `apps/web/src/lib/hosted-wake/**`
- `apps/web/test/**`
- `packages/hosted-execution/src/**`
- `packages/hosted-execution/test/**`
- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/assistant-runtime/test/**`

## Constraints

- Keep changes scoped to the returned HostedWake cutover patch and the current-tree merge needed to land it cleanly.
- Preserve unrelated active worktree edits and avoid widening into new architecture beyond this cutover slice.
- Maintain the existing fallback behavior when the signed web callback path is unavailable unless the patch explicitly requires otherwise.

## Verification

- `pnpm typecheck`
- Truthful coverage-bearing verification for touched owners via `pnpm test:diff <paths...>` if it covers the slice; otherwise owner-level coverage commands per repo policy
- Required completion-workflow audit passes for a standard repo change
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
