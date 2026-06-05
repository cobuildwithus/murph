# Connect Auth Source Gate

## Goal

Make signed-out hosted device-connect links open auth on production even when the unauthenticated `/connect` render lacks a configured `connectTarget` for the visible source.

Success criteria:

- A valid-shaped `deviceConnectIntent` hash with a known `connectSource` opens the generic auth dialog while signed out.
- The client does not POST the intent before auth.
- Unknown or malformed intent links still fail closed.
- Authenticated intent start remains server-authoritative; the server still validates claim ownership, expiry, provider, and configured target.

## Constraints

- Keep device-connect-specific link detection in the connect page, not in the generic auth dialog UI.
- Preserve unrelated hosted-auth/consent dirty files in the current checkout.
- Do not print real device-connect claims or provider secrets in logs/docs.

## Plan

1. Loosen the client-side intent start source gate so pre-existing intent claims require a known source, not a pre-auth `connectTarget`.
2. Add regression coverage for signed-out known-source links without `connectTarget`.
3. Run focused tests/typecheck and direct production/local proof where practical.
4. Run required scoped reviews, close this plan, commit, and push.

## Working Set

- `apps/web/app/(dashboard)/connect/connect-page-client.tsx`
- `apps/web/test/connect-page.test.ts`
Status: completed
Updated: 2026-06-05
Completed: 2026-06-05
