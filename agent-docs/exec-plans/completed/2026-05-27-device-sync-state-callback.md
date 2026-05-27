# Device Sync State Callback

## Goal

Make hosted device-sync provider callbacks close setup attempts through the one-time OAuth/connect state instead of requiring a browser app-session cookie on the callback origin.

## Scope

- `apps/web/app/api/device-sync/connect/[provider]/callback/route.ts`
- `apps/web/test/device-sync-callback-route.test.ts`

## Constraints

- Start routes remain app-session authenticated.
- Settings/sidebar routes remain app-session authenticated.
- Provider callbacks must not expose raw connection ids, state values, provider account ids, local paths, secrets, or direct personal identifiers.
- Keep the fix narrow; do not add a new connect-attempt persistence primitive.

## Verification

- Focused hosted device-sync callback route tests.
- Diff/app verification required by workflow.
Status: completed
Updated: 2026-05-27
Completed: 2026-05-27
