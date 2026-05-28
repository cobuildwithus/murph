# Hosted welcome email durable gate

Status: completed
Created: 2026-05-28
Updated: 2026-05-27

## Goal

- Fix hosted signup welcome delivery so the Resend email is attempted at most
  once per member after first activation, while still allowing the first attempt
  to happen when Stripe and checkout email events arrive in either order.

## Success criteria

- Later successful Stripe payments cannot trigger another welcome email.
- Browser checkout success, Stripe webhook reconciliation, and settings verified
  email sync all use the same durable send-decision primitive.
- Missing-recipient cases do not burn the one allowed attempt.
- Unverified Stripe checkout recipients are not told to start through direct
  public email routing.
- The Resend payload remains plain text only.
- Tests cover duplicate prevention, event-order recovery, and route guidance.

## Scope

- In scope:
  - Hosted welcome-email state and send orchestration under `apps/web`.
  - Prisma schema/migration for the smallest durable marker needed.
  - Focused hosted billing/email tests.
  - Durable docs where safe to edit without absorbing unrelated dirty work.
- Out of scope:
  - Changing welcome email marketing copy beyond route-safety wording.
  - Retrying failed Resend provider sends with a background worker.
  - Reworking hosted billing policy beyond the activation welcome gate.

## Constraints

- Preserve the current first-payment activation semantics.
- Preserve env-only Resend configuration, sanitized logging, and text-only body.
- Do not use Stripe checkout email for account lookup, direct-public sender
  authorization, or email-linked channel state.
- Preserve unrelated dirty worktree edits.

## Tasks

1. Add the smallest durable per-member welcome-email attempt marker.
2. Centralize welcome sending behind one claim/send helper.
3. Route checkout success, webhook reconciliation, and settings sync through it.
4. Update focused tests for duplicate prevention and event ordering.
5. Run required verification and audits.

## Decisions

- Store a single nullable `hosted_member.signup_welcome_email_attempted_at`
  marker. The welcome email is a member lifecycle side effect, not email
  authorization state, and no separate table is needed.
- Claim the marker immediately before the Resend call. Missing recipient,
  inactive billing, missing config, or stale account age do not burn the claim;
  provider failure does, because the product invariant is no duplicate welcome
  sends.
- Treat Stripe checkout email as an unverified transactional recipient hint
  only. It may receive the welcome email, but it does not unlock direct-public
  email start instructions unless Privy has verified the email.

## Verification

- `pnpm exec vitest run apps/web/test/hosted-signup-welcome-email.test.ts apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts apps/web/test/hosted-onboarding-billing-success-service.test.ts apps/web/test/hosted-onboarding-stripe-billing-events.test.ts apps/web/test/hosted-onboarding-stripe-checkout-completed.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts apps/web/test/settings-email-sync-route.test.ts --config apps/web/vitest.config.ts --no-coverage` passed after subagent fixes.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm test:diff agent-docs/SECURITY.md apps/web/README.md apps/web/prisma/schema.prisma apps/web/prisma/migrations/2026052800_hosted_signup_welcome_email_attempt/migration.sql apps/web/src/lib/hosted-onboarding/billing-success-service.ts apps/web/src/lib/hosted-onboarding/hosted-member-store.ts apps/web/src/lib/hosted-onboarding/signup-welcome-email.ts apps/web/src/lib/hosted-onboarding/stripe-billing-events.ts apps/web/src/lib/hosted-onboarding/stripe-event-reconciliation.ts apps/web/test/hosted-signup-welcome-email.test.ts apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts apps/web/test/hosted-onboarding-billing-success-service.test.ts apps/web/test/hosted-onboarding-stripe-billing-events.test.ts apps/web/test/hosted-onboarding-stripe-checkout-completed.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts apps/web/test/hosted-crypto-domain-root-store.test.ts apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-onboarding-request-auth.test.ts apps/web/test/page-auth.test.ts` passed; apps/web verify included 253 test files / 2134 tests plus build/lint/dev smoke.
- Four read-only subagents reviewed duplicate prevention, Stripe ordering, privacy/security, and Prisma/migration coverage. Findings were fixed: no migration backfill, welcome gate before Stripe receipt completion, activation retry welcome candidates, runtime nudge before welcome send, active/unsuspended atomic claim, README drift, and no full auth-header assertion.
Completed: 2026-05-27
