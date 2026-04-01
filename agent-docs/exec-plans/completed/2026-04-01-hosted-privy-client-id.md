# Hosted Privy Client ID

## Goal

Add explicit hosted web support for Privy app-client IDs so localhost and production can select different Privy web clients while keeping the existing hosted onboarding flow intact.

## Scope

- `apps/web/src/lib/hosted-onboarding/landing.ts`
- `apps/web/src/components/hosted-onboarding/{privy-provider.tsx,hosted-phone-auth.tsx,join-invite-client.tsx}`
- `apps/web/app/{page.tsx,settings/page.tsx,join/[inviteCode]/page.tsx}`
- `apps/web/test/{hosted-phone-auth.test.ts,join-page.test.ts}`
- `apps/web/{.env.example,README.md}`

## Constraints

- Do not touch the already-dirty hosted Privy completion route.
- Keep production behavior unchanged unless `NEXT_PUBLIC_PRIVY_CLIENT_ID` is configured.
- Preserve unrelated worktree edits.

## Verification

- `pnpm --dir apps/web test -- --runInBand` if supported, otherwise `pnpm --dir apps/web test`
- `pnpm --dir apps/web typecheck`
Status: completed
Updated: 2026-04-01
Completed: 2026-04-01
