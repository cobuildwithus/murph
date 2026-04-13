# Harden hosted onboarding warmup scheduling

Status: completed
Created: 2026-04-13
Updated: 2026-04-13

## Goal

- Prevent hosted onboarding success routes from returning a `400` when background managed-crypto warmup scheduling fails.
- Preserve best-effort warmup behavior for checkout-stage onboarding and billing checkout.
- Add enough diagnostics to confirm whether `next/server` `after(...)` is the production failure source.

## Success criteria

- `POST /api/hosted-onboarding/privy/complete` still returns success when warmup scheduling fails.
- `POST /api/hosted-onboarding/billing/checkout` still returns success when warmup scheduling fails.
- Focused tests cover the failure path where the scheduler throws synchronously.
- The change stays narrow and does not weaken auth or business-logic validation.

## Scope

- In scope:
- `apps/web/app/api/hosted-onboarding/privy/complete/route.ts`
- `apps/web/app/api/hosted-onboarding/billing/checkout/route.ts`
- `apps/web/src/lib/hosted-execution/control.ts`
- `apps/web/test/hosted-onboarding-privy-complete-route.test.ts`
- `apps/web/test/hosted-onboarding-billing-checkout-route.test.ts`
- Out of scope:
- Privy identity verification semantics
- Hosted member reconciliation
- Cloudflare managed-crypto provisioning behavior itself

## Constraints

- Keep the warmup best effort.
- Do not let a scheduling-only failure change a successful business outcome into a client-visible error.
- Keep route logging redaction-safe.

## Tasks

1. Add a safe helper for managed-crypto warmup scheduling that tolerates scheduler failures and logs them.
2. Route both hosted onboarding warmup call sites through the helper.
3. Add focused regressions for synchronous `after(...)` failure.
4. Run truthful `apps/web` verification and required audit passes.
Completed: 2026-04-13
