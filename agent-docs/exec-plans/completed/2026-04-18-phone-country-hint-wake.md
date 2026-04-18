## Goal

Land the supplied wake-task patch that seeds hosted phone country selection from Vercel geo headers without overriding user edits or widening the hosted onboarding surface.

## Scope

- `apps/web/proxy.ts`
- `apps/web/app/page.tsx`
- `apps/web/app/join/[inviteCode]/page.tsx`
- `apps/web/app/(dashboard)/settings/page.tsx`
- `apps/web/src/lib/hosted-onboarding/phone-country-hint*.ts`
- `apps/web/src/components/hosted-onboarding/hosted-phone-country-code-provider.tsx`
- `apps/web/src/components/hosted-onboarding/hosted-phone-auth-controller.ts`
- focused `apps/web/test/**` coverage for hosted phone hint wiring

## Constraints

- Keep the change scoped to the supplied country-hint behavior only.
- Preserve in-flight hosted phone auth completion work already present in `hosted-phone-auth-controller.ts`.
- Avoid unrelated hosted onboarding routing, copy, and auth architecture changes.

## Verification

- Truthful `pnpm test:diff` coverage for the touched `apps/web` slice if available
- Repo-required apps/web verification fallback if diff coverage is not truthful
- Required frontend/review completion steps only if current session policy allows them
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
