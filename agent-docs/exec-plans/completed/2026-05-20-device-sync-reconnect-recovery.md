# Device Sync Reconnect Recovery

## Goal

Let users recover a hosted wearable connection that reaches `reauthorization_required` by using the existing connect flow from `/connect`, settings, and a one-time preferred-channel assistant notification.

## Constraints

- Keep `device_connection` as the lifecycle authority.
- Reuse `DeviceConnectIntent` and `/device/connect/:claim`; do not add a parallel reconnect route or reconnect lifecycle table.
- Keep web as the device-sync control plane and Cloudflare/runtime as the execution plane.
- Log only safe metadata; never log tokens, raw claims, raw provider credentials, raw URLs, or contact identifiers.

## Implementation Shape

- Narrowly classify WHOOP refresh-token `invalid_request` failures as `reauthorization_required` only when the failure shape is token-specific.
- Treat `reauthorization_required` as terminal for sync scheduling by stopping reconcile churn and avoiding queued/dirty job replay.
- Surface reconnect as a first-class UI action on `/connect` and settings.
- Send proactive reconnect notices through the existing `assistant.notification.requested` mailbox path with deterministic dedupe.
- Clear stale sync error fields on successful OAuth upsert.

## Verification

- Focused provider/service/runtime/web tests passed:
  - `pnpm --dir packages/device-syncd test -- whoop-provider service`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/device-connect-intents.test.ts apps/web/test/device-sync-settings-surface.test.ts apps/web/test/connect-page.test.ts apps/web/test/device-sync-hosted-runtime-authority.test.ts apps/web/test/device-sync-reconnect-notice.test.ts apps/web/test/prisma-store-oauth-connection.test.ts`
  - `pnpm --dir packages/assistant-runtime test -- hosted-device-sync-runtime`
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff ...` passed for the changed device-sync, hosted-runtime, and web reconnect files.
- Final finish-review findings were fixed:
  - settings reconnect consent dialog clears before retry and closes on non-consent retry failure
  - proactive Junction reconnect notices use the upstream source label
  - assistant-runtime proves reauth-required dirty state is acknowledged without enqueueing jobs
- Final verification passed after those fixes:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-device-sync-settings-client.test.tsx apps/web/test/device-sync-reconnect-notice.test.ts`
  - `pnpm --dir packages/assistant-runtime test -- hosted-device-sync-runtime`
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff ...`
  - scoped `git diff --check`
Status: completed
Updated: 2026-05-20
Completed: 2026-05-20
