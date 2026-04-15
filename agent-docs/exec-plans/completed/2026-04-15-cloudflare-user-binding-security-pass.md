# Cloudflare User-Binding Security Pass

## Goal

Land the returned ChatGPT security patch that binds hosted control requests to an explicit user header and prevents secret-bearing device-sync runtime snapshots from being returned unless the caller opts in.

## Scope

- `apps/cloudflare/scripts/smoke-hosted-deploy.shared.ts`
- `apps/cloudflare/src/{dispatch-payload-store,index,runner-outbound}.ts`
- `apps/cloudflare/src/worker-routes/internal-user.ts`
- `apps/web/src/lib/device-sync/{agent-session-service,runtime-client,wake-service}.ts`
- `apps/web/src/lib/hosted-execution/{pending-usage-client,request-client}.ts`
- `apps/web/src/lib/hosted-share/pack-client.ts`
- `packages/cloudflare-hosted-control/src/client.ts`
- `packages/hosted-execution/src/client.ts`

## Constraints

- Treat the downloaded patch as behavioral intent, not overwrite authority.
- Preserve unrelated in-progress edits already present in the worktree.
- Keep the diff limited to user-bound control headers, dispatch payload deletion checks, runtime snapshot redaction, and safe runner error responses.
- Run the repo-required verification for the touched owners and report unrelated blockers separately.

## Planned Shape

1. Require `x-hosted-execution-user-id` on user-bound Cloudflare control routes and dispatch calls.
2. Propagate the bound-user header through shared hosted control clients, web request helpers, and smoke tooling.
3. Redact device-sync runtime token bundles from snapshot reads unless `includeSecrets=true`.
4. Preserve safe error summaries on runner-outbound failures and validate reference dispatch payloads before delete.

Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
