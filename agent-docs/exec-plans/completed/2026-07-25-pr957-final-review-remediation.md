# PR 957 Final ReviewGPT Remediation

## Goal

Resolve every accepted final ReviewGPT round 1 finding on PR 957, then complete
the exact-head delta-review and required verification gates.

## Constraints

- Stop Linq recovery replies from answering provider echoes without adding
  persisted state or another idempotency owner.
- Keep secondary Telegram binding strict in the existing Privy binding owner;
  leave secondary email best effort.
- Preserve the canonical checkout and join-page flow so existing subscribers
  reach the established Subscription recovery surface.
- Delete the post-completion repair decorator and avoid replacement machinery.
- Preserve direct/group privacy boundaries and source-event idempotency.

## Working Set

- `apps/web/src/lib/hosted-onboarding/visible-secondary-webhooks.ts`
- `apps/web/src/lib/hosted-onboarding/authentication-service.ts`
- `apps/web/app/api/hosted-onboarding/privy/complete/route.ts`
- Focused Linq, Privy completion, and auth-navigation tests

## Verification Plan

- Reproduce the Linq own-message echo and Privy destination failures with
  production-shaped focused tests.
- Run focused Vitest after the smallest owner-local corrections.
- Run canonical `pnpm test:diff` for the complete changed surface.
- Push an exact remediation head and run final ReviewGPT round 2 against only
  the remediation delta.
- Confirm PR-specific exact-head CI and mergeability; keep the PR draft until
  the documented PR 954 composition is possible.
Status: completed
Updated: 2026-07-25
Completed: 2026-07-25
