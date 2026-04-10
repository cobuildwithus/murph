# Hosted Signup Direct Checkout

## Goal

Route hosted signup users directly into Stripe Checkout immediately after phone verification whenever billing is still required, while preserving existing sign-in and already-active destinations.

## Why now

- The current homepage signup flow detours through `/join/:inviteCode` after verification even when the next required step is billing.
- The join route already owns the unpaid-member checkout experience, but the extra hop adds avoidable client state and user confusion.
- The long-term client architecture should have one clear post-verification continuation decision instead of split homepage vs join behavior.

## Scope

- Add a shared client helper for hosted billing checkout creation.
- Update post-verification signup continuation to launch Stripe Checkout immediately for `stage === "checkout"`.
- Keep join-page manual checkout fallback and existing active/sign-in destinations intact.
- Update focused hosted-web tests for the new continuation path.

## Constraints

- Do not change the server-side billing route contract or Stripe session semantics.
- Preserve pre-existing dirty homepage presentation edits outside the hosted signup continuation behavior.
- Keep this change inside `apps/web` hosted onboarding client/test surfaces unless a direct compile fix requires a nearby adjustment.

## Expected proof

- Truthful `apps/web` scoped verification (`pnpm test:diff ...` if it covers the slice, otherwise `pnpm --dir apps/web verify`).
- Direct scenario reasoning from the updated post-verification continuation tests.

## Status

- Ready to close.

## Done

- Registered the lane in `COORDINATION_LEDGER.md` before editing repo files.
- Added a shared hosted billing checkout client helper in `apps/web/src/components/hosted-onboarding/client-api.ts`.
- Updated homepage/default post-verification signup continuation in `apps/web/src/components/hosted-onboarding/hosted-phone-auth-support.ts` so signup users with `stage === "checkout"` go straight into Stripe Checkout.
- Reused the shared checkout helper in `apps/web/src/components/hosted-onboarding/join-invite-client.tsx` without changing server billing route semantics.
- Updated focused hosted-web tests to cover the new homepage/default continuation and to align existing assertions with the current hosted-auth copy.
- Ran `pnpm --dir apps/web test apps/web/test/hosted-phone-auth.test.ts apps/web/test/join-invite-client.test.ts`.
- Ran `pnpm test:diff apps/web/src/components/hosted-onboarding/client-api.ts apps/web/src/components/hosted-onboarding/hosted-phone-auth-support.ts apps/web/src/components/hosted-onboarding/join-invite-client.tsx apps/web/test/hosted-phone-auth.test.ts apps/web/test/join-invite-client.test.ts`.
- Ran the required `coverage-write` pass and kept its landing limited to hosted onboarding tests.
- Ran the required final review pass; it reported no findings.

## Now

- Close the active plan and create the scoped commit.

## Next

- Hand off the simplified hosted signup continuation plus the verification evidence.
Status: completed
Updated: 2026-04-10
Completed: 2026-04-10
