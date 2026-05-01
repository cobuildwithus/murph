# Connect Page Device Sync Hookup

## Goal

Make `/connect` a working hosted device-sync connection surface: authenticated members can click a configured source, start the existing settings connect flow, return to `/connect`, and see current connection state.

## Scope

- `apps/web/app/(dashboard)/connect/**`
- `apps/web/test/connect-page.test.ts`
- `apps/web/src/lib/device-sync/settings-surface.ts`
- Shared test helpers only when needed for focused `/connect` client proof.
- Small app-local helpers only if needed to map hosted connection state to connect cards.
- `packages/device-syncd/src/providers/junction-connect-sources.ts`,
  `packages/device-syncd/src/providers/junction.ts`,
  `packages/device-syncd/src/config/connect-targets.ts`,
  and directly coupled device-syncd public exports/tests for the Junction
  source-target module split requested during implementation.

## Constraints

- Keep provider preference and connect-target arbitration in `@murphai/device-syncd/config`.
- Keep Junction source-target constants and normalization in the pure
  `junction-connect-sources.ts` module so config/listing code does not import
  the provider implementation.
- Reuse existing `/api/settings/device-sync/**` browser routes and hosted control-plane state.
- Do not add new persisted state, new provider routes, or broaden the device-sync trust boundary.
- Preserve unrelated dirty work and the active Junction defaults row already touching the connect page.

## Verification

- Focused `/connect` tests for configured targets, click flow, callback handling, auth/consent errors, and connected state.
- `apps/web` typecheck or the narrowest truthful hosted-web verification available in the current dirty tree.

## Outcome

- `/connect` now uses hosted auth and device-sync settings to show signed-in,
  signed-out, connected, connect-pending, consent-required, callback success,
  and callback error states.
- Junction source-target constants and normalization live in the pure
  `junction-connect-sources.ts` module; config/listing code no longer imports
  the Junction provider implementation for source routing.
- Focused web and device-syncd tests, typechecks, and diff checks passed.
- No scoped commit was created because shared touched files overlap active
  dirty device-syncd work in the current checkout.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
