# Hosted Homepage Auth Redirect

## Goal

Send users who sign in or sign up from the public homepage to the app home route (`/home`) once hosted Privy completion reports an accessible member stage.

## Constraints

- Preserve the existing checkout-stage behavior: users who still need checkout continue through the invite join flow.
- Keep the change scoped to the shared hosted auth completion redirect and directly coupled tests.
- Do not disturb unrelated dirty homepage, settings, hosted-runtime, or phone-auth copy edits in this checkout.

## State

- Completed accessible hosted onboarding stages now route to `/home` in `completeHostedPrivyAuth`.
- Checkout and blocked/inaccessible stages still use the invite join URL.
- Homepage phone, email, and Telegram auth flow tests were updated for `/home`.

## Verification

- Passed: focused hosted auth redirect Vitest pattern covering shared completion plus homepage email, Telegram, and phone readiness paths.
- Passed: full `apps/web/test/homepage-privy-auth.test.ts` helper coverage, including `activating` -> `/home` and `blocked` -> join URL.
- Passed: scoped `git diff --check`.
- Blocked by unrelated dirty-tree web failures: app typecheck, lint, and diff-aware app verify.
Status: completed
Updated: 2026-04-30
Completed: 2026-04-30
