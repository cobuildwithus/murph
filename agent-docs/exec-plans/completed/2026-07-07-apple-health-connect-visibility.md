# Apple Health Connect Visibility

## Goal

Make Apple Health connections created through the iOS companion visible on the
hosted web `/connect` device page once the backend has confirmed a Junction
`apple_health` or `apple_health_kit` source.

## Success Criteria

- A connected Apple Health Junction source maps to the visible Apple Health
  card on `/connect`.
- Apple Health is labeled as `Apple Health` in hosted device-sync summaries.
- The web page does not offer a hosted OAuth/Junction Link start action for
  Apple Health; it remains an iOS-app-managed source.
- Focused tests cover the connected-state mapping and label behavior.

## Constraints

- Keep the companion app as the Apple Health connection flow.
- Do not add new persisted state.
- Do not expose health payload values; this is metadata/status presentation
  only.
- Preserve existing direct/Junction Link behavior for other sources.

## Working Set

- `packages/device-syncd/src/config/connect-routes.ts`
- `apps/web/src/lib/device-sync/provider-label.ts`
- `apps/web/app/(dashboard)/connect/page.tsx`
- Focused tests under `apps/web/test/**` and/or `packages/device-syncd/test/**`
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
