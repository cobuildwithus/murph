# Device Sync Deploy Compatibility

## Goal

Make the hosted device-sync dirty-state rollout safe when `apps/web` and
`apps/cloudflare` deploy at different times.

Success criteria:

- new Cloudflare tolerates old web without dirty-state routes
- new web keeps old Cloudflare able to make progress through a bounded legacy
  device-sync wake while dirty-state support rolls out
- webhook burst protection remains bounded: one legacy wake per clean-to-dirty
  transition, not one wake per webhook
- focused tests cover both rollout orders

## Constraints

- Temporary compatibility patch only; do not reintroduce per-webhook workflow
  fanout.
- Preserve unrelated dirty checkout edits.
- Do not store provider payloads or expose direct identifiers in logs/docs.

## Planned Changes

- Cloudflare runtime bridge: treat 404 from dirty-state/pending/ack routes as
  feature absence or stale already-processed state where safe.
- Web webhook acceptance: on clean-to-dirty transitions, append one coarse
  legacy `device-sync.wake` mailbox command with dirty revision metadata after
  durable acceptance, then keep direct nudge behavior.
- Tests: add rollout-order coverage for new Cloudflare against old web and old
  Cloudflare against new web.

## Completion State

Implemented and verified. Ready to close after scoped commit.

Verification:

- `pnpm --dir apps/web test device-sync-hosted-wake.test.ts`
- `pnpm --dir apps/cloudflare test:node runner-platform.test.ts`
- `pnpm --dir packages/assistant-runtime test hosted-device-sync-runtime.test.ts`
- `pnpm --dir apps/web typecheck:prepared`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm --dir packages/assistant-runtime typecheck`
- `git diff --check`
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
