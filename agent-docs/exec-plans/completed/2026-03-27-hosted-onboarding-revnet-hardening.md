# 2026-03-27 Hosted Onboarding RevNet Hardening

## Goal

Apply the requested hosted onboarding billing and webhook hardening without widening the data model: keep the single `HostedMember.walletAddress` binding, source checkout wallets only from trusted server state, prevent silent wallet replacement, move RevNet subscription activation to `invoice.paid`, freeze invoice-level issuance facts, and stop the webhook from blocking on onchain confirmation or unsafe auto-resubmission.

## Scope

- `apps/web/app/api/hosted-onboarding/billing/checkout/route.ts`
- `apps/web/src/lib/hosted-onboarding/billing-service.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- `apps/web/src/lib/hosted-onboarding/revnet.ts`
- `apps/web/src/lib/hosted-onboarding/privy.ts`
- Focused hosted onboarding tests in `apps/web/test/**`
- Docs only if the runtime contract meaning changes

## Constraints

- Do not add a separate wallet table.
- Preserve the current hosted member wallet normalization path, but only trust server-derived wallet sources.
- Avoid touching unrelated in-flight `apps/web` and Cloudflare work.
- Keep historical RevNet issuance rows immutable once created.
- The user explicitly accepts activation on `invoice.paid` even if the RevNet payment later fails or remains unreconciled.

## Planned Changes

1. Remove `walletAddress` from the checkout request body path and resolve the wallet from Privy cookies or the stored hosted member wallet inside the billing service.
2. Reject wallet conflicts with `409` instead of overwriting an existing stored wallet.
3. Keep RevNet subscription activation on `invoice.paid` only; earlier Stripe events should persist IDs and checkout state without activating the member.
4. Replace destructive issuance upserts with a load-first flow that treats chain/payment facts as immutable and only patches missing Stripe references when safe.
5. Submit RevNet payments inline but persist `submitted` state and return without waiting for confirmation; ambiguous/broadcast-unknown failures should stay stuck for reconciliation instead of flipping back to retryable `failed`.
6. Add a fallback from `invoice.parent.subscription_details.subscription` to the deprecated top-level invoice subscription field.
7. Extend focused tests for checkout wallet trust, activation timing, issuance immutability, stuck submission handling, and invoice subscription fallback.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused `apps/web` tests as needed during development
- Required completion-workflow audit passes via spawned subagents after implementation

## Current Status

- Implemented the hosted onboarding hardening pass in `billing-service.ts`, `stripe-billing-policy.ts`, `stripe-event-queue.ts`, `stripe-revnet-issuance.ts`, and the supporting Prisma schema/migration.
- Stripe billing freshness is now monotonic without relying on lexicographic `evt_*` ordering: same-second collisions either consult canonical Stripe subscription state or fail closed, while refund and cancellation-style reversals still win immediately.
- Billing blockage no longer turns normal delinquency and resume flows into sticky member suspension. Only negative reversal paths force `member.status = suspended`; later positive Stripe facts can restore access and continue RevNet issuance.
- RevNet confirmation activation is now compare-and-swap guarded against the current Stripe marker and blocked member state, so a later negative Stripe outcome can no longer be overwritten by a stale confirmation write.
- Stripe event retries now use persisted `nextAttemptAt` backoff plus a poison terminal state, and RevNet issuance recovery now distinguishes retryable `failed` rows from ambiguous `submitting` rows while auto-reclaiming stale pre-submit claims.
- Hosted checkout reuse now persists share-context provenance and revalidates the live Stripe Checkout Session before reuse, so stale or wrong-context URLs are no longer recycled.
- Focused hosted onboarding verification is green:
  - `pnpm exec prisma generate`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-onboarding-billing-service.test.ts apps/web/test/hosted-onboarding-stripe-event-queue.test.ts`
- Additional focused verification still hits an unrelated pre-existing `apps/web` typecheck failure outside this lane:
  - `pnpm --dir apps/web exec tsc --noEmit`: `src/lib/hosted-execution/hydration.ts(267,7)` `TS2532` (`Object is possibly 'undefined'`)
- Repo-wide wrappers still fail in unrelated dirty-tree work outside this lane:
  - `pnpm typecheck`: active `packages/contracts/scripts/*` module-resolution and implicit-`any` failures
  - `pnpm test`: the same unrelated `apps/web/src/lib/hosted-execution/hydration.ts(267,7)` `TS2532`
  - `pnpm test:coverage`: active `packages/cli` `@murph/contracts` resolution/type errors, followed by an unrelated cleanup failure in `packages/core/dist/domains`
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
