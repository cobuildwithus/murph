# Junction Direct Webhook Chunks

## Goal

Prevent large Junction `daily.data.*` direct webhook payloads from falling back to REST merely because the inline `webhookDataJson` would exceed the per-job cap.

Success criteria:

- Small direct webhook payloads keep the existing single-resource-job path.
- Timeseries webhook batches under `$.data.data[]` split into multiple bounded direct resource jobs when needed.
- Resource execution still imports direct webhook data before REST fallback.
- Hosted dirty-state handoff preserves the split direct jobs without a new persisted artifact/ref system.
- Focused tests prove large direct payloads avoid Junction collection fetches.

## Constraints

- Preserve existing dirty Junction/provider work in the checkout.
- Do not add new persisted state, artifact tables, or runtime fetch APIs.
- Keep inline job payloads bounded; the cap remains a per-job guardrail.
- Do not log or fixture real identifiers, raw secrets, or direct user data.

## Scope

- `packages/device-syncd/src/providers/junction.ts`
- `packages/device-syncd/test/junction-provider.test.ts`
- `apps/web/test/device-sync-hosted-wake.test.ts`

## Plan

1. Change Junction webhook job construction to accept zero or more bounded `webhookDataJson` records.
2. Split oversized `daily.data.*` timeseries batches by `data[]` chunks while keeping metadata and source provenance on each chunk.
3. Keep non-timeseries oversized direct payloads on the existing REST fallback path.
4. Add focused local provider and hosted dirty-handoff tests.
5. Run package/app scoped verification and required audits.

## Verification

Expected commands:

- `pnpm typecheck`
- `pnpm test:diff packages/device-syncd/src/providers/junction.ts packages/device-syncd/test/junction-provider.test.ts apps/web/test/device-sync-hosted-wake.test.ts`

Use scoped commands if unrelated dirty work blocks the full lane; record exact blockers.
