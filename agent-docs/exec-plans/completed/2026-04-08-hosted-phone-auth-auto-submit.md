# Hosted Phone Auth Auto Submit

## Goal

Auto-submit the hosted phone auth verification step once the user has entered a complete 6-digit code.

## Scope

- `apps/web/src/components/hosted-onboarding/hosted-phone-auth.tsx`
- `apps/web/test/hosted-phone-auth.test.ts`

## Constraints

- Preserve existing signup, sign-in, and invite behavior.
- Do not trigger duplicate submits while a verification or finalization action is already in progress.
- Keep the change narrow and composable inside the shared phone auth flow.

## Verification

- Focused hosted phone auth test
- `pnpm typecheck`
- `pnpm --dir apps/web lint`
- `pnpm test:coverage`
Status: completed
Updated: 2026-04-08
Completed: 2026-04-08
