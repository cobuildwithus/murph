## Goal

Land the supplied Cloudflare production-sweep follow-up so the runner-container boundary preserves full runner request payloads, uses direct Durable Object RPC for the main control path, and re-exports the container proxy required by outbound interception.

## Success Criteria

- `apps/cloudflare/src/index.ts` re-exports `ContainerProxy` alongside the existing worker entrypoint exports.
- `apps/cloudflare/src/runner-container.ts` exposes public `invoke()` / `destroyInstance()` RPC methods and routes the primary control helpers through those methods.
- Extended hosted runner request fields survive the Worker -> Durable Object -> container boundary unchanged.
- Cloudflare test doubles and focused regressions cover the RPC path and the preserved extended request shape.

## Scope

- `apps/cloudflare/src/{index.ts,runner-container.ts}`
- `apps/cloudflare/test/{index.test.ts,runner-container.test.ts,user-runner.test.ts}`
- `apps/cloudflare/test/workers/runner-container-double.ts`
- `agent-docs/exec-plans/active/{2026-03-30-cloudflare-prod-sweep.md,COORDINATION_LEDGER.md}`

## Risks / Notes

- Preserve adjacent dirty Cloudflare edits already in the worktree; do not widen into unrelated runner queue, deploy, or docs work unless verification proves a direct compatibility gap.
- Keep the legacy `/internal/invoke` and `/internal/destroy` fetch routes as compatibility fallbacks even though the main path moves to DO RPC.
- Repo-wide verification may still be blocked by unrelated active lanes, so record any defensible separation if that happens.
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
