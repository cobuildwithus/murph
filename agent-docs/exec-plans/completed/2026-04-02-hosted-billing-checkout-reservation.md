# Hosted Billing Checkout Reservation

## Goal

Redesign hosted Stripe checkout creation so the app reserves a single local checkout attempt before calling Stripe, then finalizes that attempt after Stripe returns, eliminating the current create-Stripe-before-DB mismatch.

## Why

- The current checkout lane creates a Stripe Checkout Session before the database transaction and can lose on the member-open unique index afterward.
- The partial unique index is member-wide, while current reuse logic is narrower and context-scoped, which can orphan Stripe sessions or force ambiguous fallback behavior.
- Long-term correctness needs a durable local reservation first, not just compensating cleanup after external side effects.

## Scope

- `apps/web/src/lib/hosted-onboarding/{billing-service.ts,billing-attempts.ts}`
- `apps/web/prisma/schema.prisma`
- new Prisma migration(s) needed for the reservation state and uniqueness rules
- focused hosted billing/reconciliation tests

## Constraints

- Preserve the current product distinction between share-context and plain invite checkout requests.
- Keep one active checkout attempt per member as the canonical invariant.
- Preserve unrelated dirty worktree edits and avoid widening into broader Stripe reconciliation or RevNet changes unless directly required by the new status model.

## Verification

- Focused hosted billing and Stripe reconciliation tests for reservation, reuse, finalize, conflict, and retry behavior
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web lint`
- any additional reliable focused checks needed for the touched lane

## Outcome

- Implemented a `pending` reservation state for hosted billing checkouts, made `stripeCheckoutSessionId` nullable until Stripe returns, and widened the active singleton uniqueness guard to `pending` plus `open`.
- `createHostedBillingCheckout` now reserves under a locked hosted-member row, reuses exact-match `pending` and `open` attempts, conflicts on mismatched active attempts, and finalizes the reserved row after Stripe session creation with a row-id-based idempotency key.
- Focused proof passed:
  - `pnpm exec vitest run apps/web/test/hosted-onboarding-billing-service.test.ts --config apps/web/vitest.workspace.ts --project hosted-web-onboarding-core`
  - `pnpm exec vitest run apps/web/test/hosted-onboarding-stripe-event-queue.test.ts --config apps/web/vitest.workspace.ts --project hosted-web-onboarding-core`
- Wider app checks remain blocked by unrelated existing failures:
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir apps/web exec tsc -p tsconfig.json --pretty false --noEmit`
  - current failures are in pre-existing `test/device-sync-internal-runtime.test.ts` and `test/hosted-onboarding-linq-dispatch.test.ts`
- `pnpm exec eslint ...` was not available from the repo root because `eslint` is not exposed there via `pnpm exec`.

## Commit Plan

- Use `scripts/finish-task` while this plan remains active so the completed plan artifact ships with the scoped commit.
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
