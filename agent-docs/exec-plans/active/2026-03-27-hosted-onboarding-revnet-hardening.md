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
