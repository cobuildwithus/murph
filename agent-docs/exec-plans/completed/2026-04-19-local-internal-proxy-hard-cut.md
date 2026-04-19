## Goal

Hard-cut the Cloudflare hosted local internal proxy onto the same opaque per-run token model as the direct internal-host path, while removing secret-bearing URL paths and the local-only HMAC user-token scheme.

## Why

- The current local bridge uses a secret in the URL path plus a second token format that signs `userId` without expiry.
- Production intent is already the opaque per-run internal worker proxy token; the local bridge should be a transport shim, not a second auth design.
- The hosted child should not prove user binding with caller-supplied headers when the worker/container already owns the run context.

## Scope

- `ARCHITECTURE.md`
- `apps/cloudflare/README.md`
- `apps/cloudflare/src/{index,internal-hosts,local-internal-proxy-token,node-runner-child,node-runner-isolated,runner-container,runner-outbound,runner-outbound/shared,runtime-platform}.ts`
- focused `apps/cloudflare/test/{index,local-loopback-proxy,node-runner-isolated,runner-container,runner-outbound,runner-platform}.test.ts`
- local hosted dev harness files only if required for the transport hard-cut under `scripts/dev-hosted-local/**`

## Constraints

- Preserve the production internal-host authority model based on the opaque per-run token.
- Keep the local bridge limited to allowlisted internal worker hosts only.
- Treat the local bridge as transport-only; do not widen the public or internal worker route surface.
- Do not revert or overwrite unrelated active Cloudflare trust-boundary edits already in flight.

## Planned shape

1. Remove the path token and local HMAC user token helpers.
2. Rewrite the local bridge to `__murph/local-internal-proxy/users/:userId/:host/...` with header-only auth and no secret-bearing URL segment.
3. Recover the bound user server-side from worker-owned runner state instead of trusting `x-hosted-execution-user-id` on this seam.
4. Keep the direct `http://*.worker` path as the canonical production contract and document the local bridge as a local transport shim.

## Verification target

- `pnpm typecheck`
- `pnpm test:diff apps/cloudflare/src/index.ts apps/cloudflare/src/runtime-platform.ts apps/cloudflare/src/runner-container.ts apps/cloudflare/src/runner-outbound.ts apps/cloudflare/src/runner-outbound/shared.ts apps/cloudflare/src/internal-hosts.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/local-loopback-proxy.test.ts apps/cloudflare/test/node-runner-isolated.test.ts ARCHITECTURE.md apps/cloudflare/README.md`

## Notes

- `runtime-platform.ts`, `internal-hosts.ts`, and `runner-outbound/shared.ts` already carry unrelated active edits. Merge carefully on top of the current worktree instead of trying to restore an older shape.
- Implemented the hard cut with one opaque per-run token model shared by direct `http://*.worker` requests and the local loopback transport shim.
- Focused Cloudflare verification passed with the updated route contract.
- Repo-wide verification still has unrelated pre-existing blockers:
  - `pnpm typecheck` fails in `apps/web` on missing opposite Prisma relation fields for `HostedWakeTerminal`.
  - `pnpm test:diff ...` fails in `apps/cloudflare/test/workers/test-hosted-wake-control.ts` because that file currently has a standalone syntax error at line 178.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
