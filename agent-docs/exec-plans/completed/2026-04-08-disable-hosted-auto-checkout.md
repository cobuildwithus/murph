# Disable hosted homepage auto-checkout after OTP verification

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Keep the hosted homepage phone-auth flow on Murph after Privy SMS verification instead of immediately redirecting the browser to Stripe Checkout.

## Success criteria

- The default hosted homepage post-OTP flow no longer creates a checkout session and leaves the site immediately.
- After successful Privy completion with stage `checkout`, the browser goes to the local join page instead.
- Existing sign-in behavior for already-active accounts still lands on `/settings`.
- Focused hosted-phone-auth tests cover the new redirect behavior.

## Scope

- In scope:
- `apps/web/src/components/hosted-onboarding/hosted-phone-auth-support.ts`
- `apps/web/test/hosted-phone-auth.test.ts`
- Out of scope:
- Invite-page auto-checkout behavior
- Stripe billing route behavior
- Lower-level Privy token verification or request-auth changes

## Constraints

- Keep this as a narrow behavior toggle for diagnosis.
- Preserve the existing join-page checkout step rather than inventing a new intermediate page.
- Do not weaken the current hosted auth contract.

## Risks and mitigations

1. Risk: signup could stop progressing after OTP verification.
   Mitigation: redirect to the existing `joinUrl`, which already owns the checkout UI.
2. Risk: existing-account sign-in could regress.
   Mitigation: keep the `signin + active -> /settings` redirect rule unchanged and cover it in focused tests.

## Tasks

1. Remove the default post-OTP homepage checkout-session creation path.
2. Add a focused regression test proving `checkout` now resolves to the local join route instead of Stripe.
3. Run required verification, review, and scoped commit flow.

## Verification

- Focused test passed:
- `pnpm --dir ../.. exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-phone-auth.test.ts`
- `pnpm --dir apps/web lint` passed with pre-existing warnings only.
- `pnpm typecheck` failed outside this change in `packages/cli/src/vault-cli.ts`: missing export `loadRuntimeModule` from `@murphai/vault-usecases`.
- `pnpm test:coverage` failed outside this change during prepared runtime build: expected `packages/cli/src` to import required `@murphai/assistant-cli` subpath `run-terminal-logging`.

## Review

- Final review found one low-severity follow-up risk: the helper now reconstructs the local join route instead of using the absolute server-provided `joinUrl`, so future server-owned join URL shape changes could drift.
- Accepted for this narrow fix because the immediate issue was redirecting to the production host from localhost, and the current join route shape is stable enough for the temporary fix.

Completed: 2026-04-08
Completed: 2026-04-08
