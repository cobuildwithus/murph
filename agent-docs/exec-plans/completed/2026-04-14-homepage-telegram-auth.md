# Homepage Telegram Auth

## Goal

Add a Telegram login button to the hosted homepage auth panel and make hosted Privy completion/member identity tolerant of Telegram-only sessions so the new button can complete signup or sign-in instead of failing on missing phone state.

## Scope

- `apps/web/src/components/homepage/**`
- `apps/web/src/components/hosted-onboarding/**`
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/app/api/hosted-onboarding/privy/complete/route.ts`
- `apps/web/prisma/**`
- Focused `apps/web/test/**` coverage for homepage auth and hosted onboarding identity flows

## Constraints

- Preserve existing SMS invite/signup behavior.
- Keep hosted member identity matching fail-closed on conflicts.
- Preserve unrelated dirty worktree edits outside `apps/web/**` and the active plan/ledger files.

## Verification

- `pnpm typecheck`
- `pnpm test:diff apps/web`
- `pnpm --dir apps/web verify`

## Status

- In progress
Status: completed
Updated: 2026-04-14
Completed: 2026-04-14
