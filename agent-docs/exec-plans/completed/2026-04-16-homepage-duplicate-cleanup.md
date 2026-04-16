## Goal

Remove the dead duplicate homepage implementation and homepage-only component set, while keeping the canonical homepage copy and any shared assets still used elsewhere.

## Scope

- `apps/web/app/page.tsx`
- `apps/web/app/old-homepage/page.tsx`
- `apps/web/src/components/homepage/**`
- `apps/web/test/old-homepage-page.test.ts`

## Constraints

- Keep the canonical homepage at `/` unchanged except for the requested local-run section copy.
- Preserve shared icons still imported by hosted onboarding.
- Remove dead variants rather than preserving alternate homepage routes.

## Verification

- Focused `apps/web` tests for the canonical homepage/auth controls
- Reference search confirming no remaining imports of deleted homepage-only files
- App-level verification for touched `apps/web` files per repo policy
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
