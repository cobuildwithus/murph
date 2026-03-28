# 2026-03-28 Device-Sync WHOOP Hosted Hardening

## Goal

Resolve the remaining hosted/device-sync correctness and idempotency bugs called out in review:

- stale hosted snapshots must not roll back fresher local hosted-runtime state
- WHOOP webhook dedupe must survive retry deliveries that arrive with a new transport timestamp
- hosted and local provider configuration must be sourced from one shared factory/config reader
- clearing sync errors must also clear the stale error timestamp
- WHOOP revoke must not consume refresh-token rotation outside the persisted rotation path

## Scope

- Add the minimum persisted hosted-mirror bookkeeping needed in local device-sync sqlite so hosted sync can distinguish "hosted advanced" from "local has unpushed changes".
- Tighten hosted snapshot hydration so stale hosted reads cannot resurrect invalidated WHOOP refresh tokens or rewind local `nextReconcileAt`.
- Make WHOOP synthetic webhook trace ids body/content-based instead of transport-timestamp-based, and preserve delete-marker timestamps from webhook payloads when available.
- Replace the repeated hosted/local provider wiring with one `packages/device-syncd` config/factory path.
- Fix both local sqlite and hosted Prisma clear-error paths so `lastSyncErrorAt` converges with cleared error fields.
- Remove the revoke-only WHOOP refresh path that bypasses persisted token rotation.

## Constraints

- Preserve the existing hosted control-plane trust boundary and the current local `device-syncd` provider surface.
- Work on top of the already-dirty tree without reverting unrelated hosted-runtime, hosted-web, or Cloudflare edits.
- Keep the change scoped to the confirmed correctness/idempotency bugs and direct regression coverage; do not widen into broader hosted control-plane redesign.

## Planned Shape

1. Add hosted-observed mirror fields to local device-sync runtime state and use them during hosted snapshot hydration to preserve fresher local state until hosted actually advances.
2. Update hosted reconciliation tests so stale hosted snapshots cannot roll back local token rotation or `nextReconcileAt`.
3. Switch WHOOP missing-`trace_id` synthesis to a payload-stable identity, add the retry-with-new-timestamp regression, and preserve delete `occurred_at` from webhook payloads when present.
4. Export one shared provider-config/provider-factory path from `packages/device-syncd` and reuse it from hosted web plus hosted runtime.
5. Clear `lastSyncErrorAt` anywhere `clearError`/`clearErrors` clears the error code/message fields.
6. Remove the revoke-only WHOOP refresh helper and rely on the existing persisted access token path.

## Verification Plan

- Run focused Vitest coverage for:
  - `packages/device-syncd/test/{whoop-provider.test.ts,service.test.ts}`
  - `packages/assistant-runtime/test/{hosted-device-sync-runtime.test.ts,hosted-runtime-maintenance.test.ts}`
  - `apps/web/test/{device-sync-internal-runtime.test.ts,env.test.ts,prisma-store-local-heartbeat.test.ts}`
- Run repo-required `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.
- Record direct scenario evidence through the new focused regressions covering stale hosted hydration, WHOOP retry dedupe with a new transport timestamp, and clear-error convergence.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
