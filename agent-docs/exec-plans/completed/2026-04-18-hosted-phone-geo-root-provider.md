## Goal

Move hosted phone geo prefill to one top-level app provider, read Vercel geo headers directly, and remove the current proxy/cookie indirection.

## Scope

- `apps/web/app/layout.tsx`
- `apps/web/app/page.tsx`
- `apps/web/app/join/[inviteCode]/page.tsx`
- `apps/web/app/(dashboard)/settings/page.tsx`
- `apps/web/proxy.ts`
- `apps/web/src/lib/hosted-onboarding/phone-country-hint*.ts`
- `apps/web/src/components/hosted-onboarding/hosted-phone-auth-controller.ts`
- focused `apps/web/test/**` coverage for layout, page shells, and phone hint behavior

## Constraints

- Keep the country hint behavior server-derived and lightweight.
- Preserve the existing client context contract so hosted phone auth consumers do not need API changes.
- Avoid unrelated hosted onboarding, billing, or invite-flow behavior changes.

## Verification

- Focused `apps/web` tests for the touched geo/provider and phone auth flows
- App-level verification for the touched `apps/web` slice per repo policy
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
