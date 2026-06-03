# Provider Egress Active User Fence

## Goal

Replace tokenless OpenAI provider-egress active-container authorization with a
trusted active-user-fence check. The fix should preserve diagnostics, keep
Worker-owned provider secret injection, and keep provider-token validation for
runtime-controlled provider integrations.

## Scope

- `apps/cloudflare/src/runner-egress-intercept.ts`
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/src/user-runner/runner-state-store.ts`
- `apps/cloudflare/src/user-runner/hosted-user-runner.ts`
- `apps/cloudflare/src/worker-contracts.ts`
- Focused Cloudflare tests for provider egress and runner state
- Hosted runtime provider-egress docs

## Constraints

- Do not remove structured provider-egress or OpenAI cache diagnostics.
- Do not inject per-invocation provider tokens into the warm Codex App Server.
- Do not authorize tokenless OpenAI from user-supplied request headers alone.
- Keep Linq, Telegram, WhatsApp, and Mapbox on provider-egress token or exact
  write-fence proof when authority headers are absent.
- Keep container names for lifecycle routing only, not provider-egress auth.

## Plan

1. Add tests for tokenless OpenAI active-user-fence success and failure with an
   opaque container id.
2. Let the outbound handler resolve the current container Durable Object from
   `ctx.containerId`, read the current active invocation user from that object,
   and validate that user's active write fence.
3. Rename provider-egress diagnostics from `active_container` to
   `active_user_fence` for the tokenless OpenAI fallback.
4. Remove runner-container-name equality from active provider-egress validation.
5. Update docs to describe the new trust model.
6. Run focused tests, typecheck/verification, required audits, and a local
   runtime log proof when feasible.
Status: completed
Updated: 2026-06-03
Completed: 2026-06-03
