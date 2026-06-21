# Cancelled Subscription Resend Email

## Goal

Send a plain-text founder-style feedback/refund email through Resend when a hosted Stripe subscription is cancelled, with retry ownership on the hosted Stripe event receipt and provider idempotency so one cancellation does not generate repeat emails across webhook retries.

## Scope

- `apps/web` hosted Stripe reconciliation and billing email helpers.
- Focused hosted onboarding billing/email tests.

## Constraints

- Keep Resend credentials, sender identity, and recipients in env only.
- Do not persist provider payloads or log recipient addresses.
- Do not use unverified checkout email for account lookup or channel state.
- Keep workflow inputs pointer-only; no raw Stripe/customer/email payloads in workflow state.
- Plain-text email only.

## Verification Plan

- Focused hosted onboarding billing/email tests.
- `pnpm typecheck`.
- `pnpm test:diff` for touched files if truthful; otherwise app-local hosted web verification per repo rules.
- Required completion audits: security/privacy, coverage-write, and deep-review if the final diff materially alters billing side-effect ordering.

## Progress

- Done: created isolated task branch/worktree.
- Done: traced existing Stripe cancellation reconciliation and Resend welcome/internal-notification paths.
- Done: implemented a retryable cancellation feedback email after a confirmed cancellation billing write, with the existing hosted Stripe event receipt controlling retries until completion and a subscription-scoped Resend idempotency key controlling provider dedupe.
- Done: added focused tests for the email helper, Stripe billing candidate selection, and event reconciliation side-effect ordering.
- Done: ran required verification: Prisma validate, focused Vitest, typecheck, and `pnpm test:diff` for the touched apps/web slice.
- Done: ran completion audits: security/privacy and deep review found no actionable findings; coverage-write added one negative-path reconciliation test.
- Now: closing the active plan with a scoped commit.
- Next: handoff.
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21
