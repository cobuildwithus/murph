# Hosted Activation Progress

## Goal

Make hosted checkout handoff and return flow reflect the real post-payment activation lifecycle.

## Success Criteria

- Stripe success URLs preserve the live `CHECKOUT_SESSION_ID` placeholder.
- Hosted invite status can represent payment-complete activation-in-progress without collapsing back to checkout.
- The join page and success page show activation-pending copy and poll until the member becomes active.
- Focused tests cover the new stage and URL behavior.

## Scope

- `apps/web/app/join/[inviteCode]/success/page.tsx`
- `apps/web/src/components/hosted-onboarding/join-invite-client.tsx`
- `apps/web/src/lib/hosted-onboarding/{billing.ts,invite-service.ts,lifecycle.ts,types.ts}`
- `apps/web/test/{hosted-onboarding-billing-service.test.ts,join-invite-client.test.ts}`

## Constraints

- Keep the refactor narrow and composable.
- Preserve the existing uncommitted active-state redesign in `join-invite-client.tsx`.
- Do not add new persistence or operator-only public endpoints for this pass.

## Verification

- `pnpm typecheck`
- `pnpm --dir apps/web test -- --run ...focused files...`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web verify`
Status: completed
Updated: 2026-04-08
Completed: 2026-04-08
