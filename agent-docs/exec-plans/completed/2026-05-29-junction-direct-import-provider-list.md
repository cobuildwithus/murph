# Junction Direct Import Provider List Decoupling

## Goal

Keep Junction/Garmin direct webhook payload drains independent from the
Junction `user/providers` endpoint so dirty payload imports can continue when
provider-list projection is slow or temporarily unavailable.

## Constraints

- Preserve granular durable local jobs and exact dirty payload ack semantics.
- Keep Junction source/provider projection available for reconcile, backfill,
  disconnect, diagnostics, and other control-plane paths.
- Do not add a cache, queue, lease protocol, or new persisted state.
- Keep provider payloads and health data out of logs and docs.

## Plan

1. Remove best-effort source projection from direct webhook import execution.
2. Keep the existing `user/providers` usage in non-direct control-plane paths.
3. Add focused regression tests proving single and batched direct payload
   imports do not call `user/providers`.
4. Run focused device-sync verification plus required completion audits.

## Verification

- Focused Junction provider tests covering direct import behavior.
- `pnpm typecheck`
- `pnpm test:diff` or `pnpm --dir packages/device-syncd test:coverage`
Status: completed
Updated: 2026-05-28
Completed: 2026-05-28
