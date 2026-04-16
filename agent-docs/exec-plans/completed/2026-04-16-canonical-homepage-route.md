## Goal

Make the homepage implementation canonical at `/` and remove the legacy `/lp` route entirely, without redirects or route-import shims.

## Scope

- `apps/web/app/page.tsx`
- `apps/web/app/auth-controls.tsx`
- `apps/web/app/sticky-nav.tsx`
- remove `apps/web/app/lp/**`
- focused `apps/web/test/{page,lp-auth-controls}.test.tsx?`

## Constraints

- Preserve the current homepage behavior and metadata at `/`.
- Remove the `/lp` route instead of redirecting or re-exporting through it.
- Keep the change narrow to route ownership, imports, and directly affected tests.

## Verification

- Focused `apps/web` tests covering canonical homepage rendering and auth controls
- App-level verification for touched `apps/web` files per repo policy
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
