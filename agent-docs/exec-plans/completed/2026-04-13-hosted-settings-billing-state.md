# Hosted Settings Billing State

## Goal

Make hosted settings treat canceled or otherwise blocked billing states explicitly instead of mislabeling them as incomplete activation.

## Scope

- Refine hosted onboarding/settings entitlement helpers for state-specific access errors.
- Allow billing portal access for authenticated hosted members with a Stripe customer even when billing is canceled.
- Update settings UI copy/rendering so blocked wearable settings do not also show the empty-state card.
- Add focused tests for canceled and inactive hosted member settings behavior.

## Constraints

- Preserve existing hosted billing policy: cancellation still revokes active hosted access.
- Keep the change limited to hosted web settings/auth surfaces and tests.
- Preserve unrelated dirty worktree edits already present in Cloudflare deploy files.

## Verification

- Run truthful `apps/web`-scoped verification for the touched hosted settings/onboarding files.
- Capture at least one direct behavior check from the relevant tests covering canceled-member settings behavior.

## Outcome

- Billing portal access now uses authenticated hosted-member auth plus suspension checks, so canceled members with a stored Stripe customer can still reach Stripe self-serve management.
- Active-only settings surfaces now return billing-state-specific messages for canceled, unpaid, paused, and past-due accounts instead of the generic activation copy.
- Blocked wearable loads now render a dedicated unavailable state instead of also showing the "No wearables available yet" empty state.

## Verification Results

- `pnpm --dir apps/web test -- --run test/hosted-onboarding-entitlement.test.ts test/hosted-onboarding-request-auth.test.ts test/settings-billing-portal-route.test.ts test/device-sync-settings-service.test.ts test/hosted-device-sync-settings.test.tsx test/hosted-device-sync-settings-client.test.tsx`
- `pnpm --dir apps/web lint` (passes with pre-existing warnings elsewhere in `apps/web`; no new errors)
- `pnpm test:diff apps/web/app/api/settings/billing/portal/route.ts apps/web/src/lib/hosted-onboarding/entitlement.ts apps/web/src/components/settings/hosted-device-sync-settings.tsx apps/web/src/components/settings/hosted-device-sync-settings-client.tsx apps/web/src/components/settings/hosted-device-sync-settings-sections.tsx apps/web/test/hosted-onboarding-entitlement.test.ts apps/web/test/hosted-onboarding-request-auth.test.ts apps/web/test/settings-billing-portal-route.test.ts apps/web/test/device-sync-settings-service.test.ts apps/web/test/hosted-device-sync-settings.test.tsx apps/web/test/hosted-device-sync-settings-client.test.tsx`

## Notes

- Current settings surfaces conflate `incomplete` and `canceled` behind `HOSTED_ACCESS_REQUIRED`, which produces the misleading "Finish hosted activation before continuing." message and blocks Stripe portal access.
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
