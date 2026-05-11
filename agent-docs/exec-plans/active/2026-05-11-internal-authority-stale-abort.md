# Internal Authority Stale Abort

Status: active
Created: 2026-05-11
Updated: 2026-05-11

## Goal

- Treat Worker-owned internal hosted runtime `401` and `403` responses as terminal stale invocation authority signals so old runner children abort locally instead of retrying or continuing mutable effects.

## Success criteria

- Internal Murph routes reached through the invocation proxy classify `401`/`403` as stale invocation authority.
- Runtime heartbeat maps stale internal authority rejection into a liveness rejection instead of a retryable heartbeat transport error.
- Replay-safe mailbox reads and provider-effect calls do not retry after stale internal authority rejection.
- External provider `401` responses remain ordinary provider/domain responses and are not classified as stale invocation authority.
- Focused tests cover the classification boundary.

## Scope

- In scope:
  - `apps/cloudflare/src/runtime-platform.ts`
  - Focused Cloudflare runtime platform tests.
- Out of scope:
  - New durable lifecycle tables.
  - Token refresh/reconciliation.
  - Web-owned lifecycle state.
  - Broad runner-container or Durable Object lifecycle rewrites.

## Constraints

- The per-user runner Durable Object active invocation lease remains the single lifecycle authority.
- Proxy tokens protect internal routes but are not durable truth.
- Stale runners must fail closed and let compare-and-clear/alarm recovery own durable cleanup.
- Preserve unrelated dirty worktree edits and active hosted-runner rows.

## Tasks

1. Register narrow coordination scope.
2. Add stale internal authority error/classifier at the Cloudflare runtime internal fetch boundary.
3. Ensure liveness heartbeat returns a fatal liveness rejection for stale internal authority.
4. Add focused tests for internal mailbox/effects/heartbeat and external provider status separation.
5. Run focused verification and inspect the diff for accidental identifier leakage.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-platform.test.ts --no-coverage`
  - `pnpm --dir apps/cloudflare typecheck`
  - `git diff --check`

## Notes

- No new lifecycle state should be introduced by this plan.
