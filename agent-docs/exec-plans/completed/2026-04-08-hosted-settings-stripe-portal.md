# Hosted Settings Stripe Portal

## Goal

Add the simplest possible self-serve subscription-management handoff from hosted `/settings` to Stripe.

## Success Criteria

- Hosted `/settings` shows a clear billing card with one action to manage the subscription in Stripe.
- The action calls a narrow authenticated hosted-web route that creates a Stripe Billing Portal session for the current member.
- The route uses the current hosted member's stored Stripe customer reference and returns a redirect URL back to `/settings`.
- Focused tests cover the route contract and settings-page rendering.

## Scope

- `apps/web/app/api/settings/billing/portal/route.ts`
- `apps/web/src/components/settings/hosted-billing-settings.tsx`
- `apps/web/app/settings/page.tsx`
- focused tests under `apps/web/test/**`

## Constraints

- Keep architecture minimal and composable.
- Do not expand into a broader billing dashboard or subscription-state UI.
- Reuse existing hosted request-auth, Stripe runtime, and client request helpers.

## Verification

- focused hosted-web tests for the new settings route and UI
- `pnpm --dir apps/web verify`
Status: completed
Updated: 2026-04-08
Completed: 2026-04-08
