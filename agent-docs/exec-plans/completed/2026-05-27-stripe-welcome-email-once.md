# Send hosted signup welcome email once after first payment

Status: completed
Created: 2026-05-27
Updated: 2026-05-27

## Goal

- Ensure the Resend-backed hosted signup welcome email is sent at most once per
  first paid activation path rather than every later successful Stripe payment.

## Success criteria

- Later `invoice.paid` events for an already-active member do not create a new
  activation/welcome side effect.
- Later `invoice.paid` events that recover a member after prior activation do
  not create a second activation/welcome side effect.
- The fix uses the existing activation/mailbox invariant instead of introducing
  new persisted sent-marker state.
- The Stripe checkout email remains an encrypted unverified recipient hint only;
  it is not used for account lookup or sender authorization.
- Focused hosted onboarding tests cover active-member renewal behavior and prove
  reconciliation does not call Resend when no new activation occurred.
- Required verification and completion audits pass or any unrelated blockers are
  recorded precisely.

## Scope

- In scope:
  - Hosted Stripe positive invoice activation behavior.
  - Focused `apps/web` hosted onboarding tests.
  - Durable docs that describe the welcome email privacy/idempotency contract.
- Out of scope:
  - Changing email copy or Resend provider choice.
  - Broad Stripe billing lifecycle redesign.
  - In-chat assistant signup welcome notification copy or delivery behavior
    except where recurring payments would incorrectly re-trigger activation.

## Constraints

- Technical constraints:
  - Keep Resend API key and sender identity env-only.
  - Do not persist raw provider payloads, email bodies, API keys, or full
    recipient values for send idempotency.
  - Avoid new persisted state unless the existing activation invariant is
    insufficient.
  - Preserve billing monotonicity and Stripe event retry behavior.
- Product/process constraints:
  - Preserve unrelated dirty worktree edits.
  - Do not expose local identifiers, raw contact data, secrets, provider
    payloads, or local paths in code, docs, logs, commits, or handoff.

## Risks and mitigations

1. Risk: Later recurring invoices continue to create activation side effects.
   Mitigation: Make `skipIfBillingAlreadyActive` skip active-member activation
   side effects even when the current invoice has no existing activation wake.
2. Risk: Payment recovery after a past-due state looks like a fresh activation.
   Mitigation: For paid invoice activation, treat an existing `member.activated`
   mailbox fact or retained active hosted crypto roots as prior-activation
   proof.
3. Risk: Over-correcting could suppress first activation if the member was not
   previously active.
   Mitigation: Scope the skip to callers that explicitly set
   `skipIfBillingAlreadyActive` or `skipIfPreviouslyActivated`; first paid
   invoices without a previous `member.activated` mailbox fact still activate.

## Tasks

1. Confirm the current Stripe invoice and Resend call path.
2. Fix active-member positive invoice activation skip behavior.
3. Add focused tests for renewal skip behavior and no Resend call.
4. Update durable docs for the once-only welcome email contract.
5. Run required verification and completion audits.
6. Close the plan and create a scoped commit if safe.

## Decisions

- Do not add a welcome-email sent marker for this bug. The simpler invariant is
  that recurring or recovery paid invoices should not produce a new activation
  result when billing was already active, a `member.activated` mailbox fact
  exists, or retained active hosted crypto roots prove prior activation, so the
  existing post-activation Resend hook is not reached.
- Keep Resend as best effort after Stripe reconciliation commits; provider
  outages should not fail Stripe reconciliation.

## Verification

- Completed:
  - `pnpm exec vitest run apps/web/test/hosted-onboarding-member-activation.test.ts apps/web/test/hosted-onboarding-stripe-billing-events.test.ts apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts --config apps/web/vitest.config.ts --no-coverage`
    passed: 3 files, 53 tests.
  - `pnpm exec vitest run apps/web/test/hosted-mailbox-store.test.ts apps/web/test/hosted-onboarding-member-activation.test.ts apps/web/test/hosted-onboarding-stripe-billing-events.test.ts apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts --config apps/web/vitest.config.ts --no-coverage`
    passed after the payment-recovery edge fix: 4 files, 71 tests.
  - `pnpm exec vitest run apps/web/test/hosted-crypto-domain-root-store.test.ts apps/web/test/hosted-mailbox-store.test.ts apps/web/test/hosted-onboarding-member-activation.test.ts apps/web/test/hosted-onboarding-stripe-billing-events.test.ts apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts --config apps/web/vitest.config.ts --no-coverage`
    passed after the retention-safe prior-activation proof: 5 files, 78 tests.
  - `pnpm exec vitest run apps/web/test/hosted-crypto-domain-root-store.test.ts apps/web/test/hosted-mailbox-store.test.ts apps/web/test/hosted-onboarding-member-activation.test.ts apps/web/test/hosted-onboarding-stripe-billing-events.test.ts apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts --config apps/web/vitest.config.ts --no-coverage`
    passed after coverage follow-up edits: 5 files, 79 tests.
  - `bash scripts/workspace-verify.sh test:diff ARCHITECTURE.md agent-docs/SECURITY.md apps/web/README.md apps/web/src/lib/hosted-onboarding/member-activation.ts apps/web/test/hosted-onboarding-member-activation.test.ts apps/web/test/hosted-onboarding-stripe-billing-events.test.ts apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts`
    passed before the payment-recovery edge fix after removing an empty stale
    migration directory from the discarded sent-marker approach.
  - `bash scripts/workspace-verify.sh test:diff ARCHITECTURE.md agent-docs/SECURITY.md apps/web/README.md apps/web/src/lib/hosted-crypto/domain-root-store.ts apps/web/src/lib/hosted-mailbox/store.ts apps/web/src/lib/hosted-onboarding/member-activation.ts apps/web/src/lib/hosted-onboarding/stripe-billing-events.ts apps/web/test/hosted-crypto-domain-root-store.test.ts apps/web/test/hosted-mailbox-store.test.ts apps/web/test/hosted-onboarding-member-activation.test.ts apps/web/test/hosted-onboarding-stripe-billing-events.test.ts apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts`
    passed after the final implementation: apps/web lint, tests, dev smoke, and
    Next build completed.
  - `pnpm typecheck` passed before and after the payment-recovery edge fix,
    and after the retained crypto-root prior-activation proof.
  - `pnpm typecheck` passed after the final coverage follow-up edits.
  - `pnpm verify:acceptance` passed.
  - `git diff --check -- <task files>` passed.
  - Marker-state sweep passed: no signup welcome sent-marker fields/functions
    or stale migration directory remain.
- Completion audits:
  - Security review: no findings.
  - Task-finish review: no findings after the payment-recovery and retention
    edges were covered.
  - Coverage follow-up: no remaining focused coverage gaps after adding the
    crypto-root active-status and recovery skip assertions.
Completed: 2026-05-27
