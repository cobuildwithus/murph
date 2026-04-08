# Hosted Phone Auth Simplify

## Goal

Simplify the hosted phone auth implementation after the existing-account sign-in addition by reducing duplicated public/invite rendering branches and keeping the component tree more composable without changing behavior.

## Scope

- `apps/web/src/components/hosted-onboarding/hosted-phone-auth.tsx`
- `apps/web/src/components/hosted-onboarding/hosted-phone-auth-views.tsx`
- focused tests in `apps/web/test/hosted-phone-auth.test.ts`

## Constraints

- Preserve the newly added existing-account sign-in UX and redirect behavior.
- Preserve invite signup behavior exactly.
- Keep the diff behavior-preserving and internal-structure-focused.

## Verification

- Focused hosted phone auth tests
- `pnpm typecheck`
- `pnpm --dir apps/web lint`
- `pnpm test:coverage`
Status: completed
Updated: 2026-04-08
Completed: 2026-04-08
