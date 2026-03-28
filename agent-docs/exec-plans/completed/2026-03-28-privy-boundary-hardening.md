# Privy Boundary Hardening

## Goal

Make one hosted-onboarding server helper the only boundary that upgrades a hosted session plus Privy cookie into a verified Privy user for the same hosted member, then route billing and settings flows through it while removing thin indirection and duplicate Privy policy literals.

## Scope

- `apps/web/src/lib/hosted-onboarding/{privy.ts,billing-service.ts,route-helpers.ts,service.ts}`
- `apps/web/app/api/settings/{email,telegram}/sync/route.ts`
- `apps/web/app/api/hosted-onboarding/{billing/checkout,invites/[inviteCode]/status,linq/webhook,privy/complete,stripe/webhook,telegram/webhook}/route.ts`
- `apps/web/src/components/{hosted-onboarding/privy-provider.tsx,settings/hosted-email-settings.tsx,settings/hosted-telegram-settings.tsx}`
- Focused `apps/web/test/**` coverage for the changed boundaries

## Invariants

- Server-side Privy verification stays in `apps/web` and always validates the `privy-id-token` cookie before trusting linked-account data.
- Session-to-Privy binding rejects mismatched hosted-member / Privy-user pairs before email, Telegram, or billing uses linked accounts.
- Hosted member reconciliation rules stay centralized in `member-service.ts`.
- Client and server Privy wallet policy stay aligned through shared constants instead of duplicated literals.
- Settings page remains the only provider boundary for the settings surface.

## Verification Target

- Focused `apps/web` tests covering the new helper, settings sync routes, provider config, and billing wallet resolution.
- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
