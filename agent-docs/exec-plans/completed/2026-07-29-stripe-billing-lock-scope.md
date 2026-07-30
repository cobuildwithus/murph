# Bound Stripe billing transaction scope

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Preserve the PR's direct-Checkout and first-winner billing guarantees without
  holding a database transaction, connection, or member row lock across Stripe
  requests or hosted-field encryption/decryption.

## Success criteria

- Direct Checkout uses short claim and compare-and-set transactions around
  provider and crypto work.
- Standard Checkout completion performs all Stripe and hosted-field crypto work
  before entering the member-locked transaction.
- Transaction-owned helpers are database-only and accept prepared ciphertext
  plus blind lookup keys at their boundary.
- Focused regression tests prove Stripe and crypto preparation finish before
  the member lock is acquired.
- Canonical verification, CI, and the authorized ReviewGPT loop pass on the
  exact PR head.

## Scope

- Direct member Checkout claim, resume, bind, and loser cleanup.
- Standard Checkout completion classification and first-winner binding.
- Focused hosted Web billing and reconciliation tests.
- Current billing architecture/reliability documentation only if the durable
  contract is not already explicit.

## Constraints

- Keep the existing hosted-member row as the sole mutation owner.
- Add no queue, scheduler, service, dependency, or second billing state owner.
- Preserve current user-visible success, retry, syncing, suspension, and
  Family-conflict behavior.
- Keep Stripe identifiers encrypted at rest and use blind lookup keys for
  comparisons inside transactions.
- Do not widen this correction into unrelated pre-existing billing debt.

## Tasks

1. [x] Split direct Checkout into short claim, external work, and short bind or
   revalidation phases.
2. [x] Move standard completion provider and crypto preparation outside the
   member-locked transaction.
3. [x] Add ordering and concurrency regression proof.
4. [x] Run focused and canonical verification.
5. [x] Close the implementation plan and publish the exact remediation head for
   the final PR gates.

## Verification log

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage
  apps/web/test/hosted-onboarding-member-billing-checkout-attempt.test.ts
  apps/web/test/hosted-onboarding-billing-service.test.ts
  apps/web/test/hosted-onboarding-stripe-billing-events.test.ts
  apps/web/test/hosted-onboarding-billing-success-service.test.ts
  apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts
  apps/web/test/hosted-onboarding-stripe-checkout-completed.test.ts`
  (204 tests passed)
- `pnpm --dir apps/web typecheck:prepared`
- Scoped ESLint over all changed hosted billing source and test files.
- `git diff --check`
- `pnpm test:diff <active plan and all 15 changed source/test files>` (all
  repository guards, 7,394 Web tests, TypeScript, lint with zero errors, dev
  smoke, and the production build passed)
- `MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance` (exact candidate tree
  `b83dc1fa893097d0d0c284decc3be2cc11116f5e`; Blacksmith Testbox
  `tbx_01kyp9q22yep5jdckdkv9g8dn2`; full acceptance passed)
Completed: 2026-07-29
Completed: 2026-07-29
