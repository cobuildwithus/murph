# Preserve ambiguous top-up request identity

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Keep one payer-scoped request identity authoritative until an ambiguous
  create-capable usage top-up request resolves to a purchase.

## Success criteria

- A recovery miss returns an unselected picker without discarding the original
  request key.
- The next explicit authorization reuses that key in normal create-capable mode.
- If a delayed original request and the next explicit request race, the
  payer-lock uniqueness fence permits only one purchase and one provider
  lifecycle.
- Reusing that key for a newly selected offer returns the winning purchase as a
  nonpayable offer conflict when the delayed request won another offer.
- Personal, Family, and group browser flows retain the key across recovery miss,
  dismissal, and reopen.

## Scope

- In scope: selection-state request-key retention, exact-key offer-conflict
  projection, ordering regression tests, and live billing/reliability/security
  documentation.
- Out of scope: new endpoints, tombstones, durable fields, queues, provider
  cancellation, or another payment owner.

## Tasks

1. [x] Reproduce recovery-before-original-lock ordering.
2. [x] Retain the ambiguous key through recovery miss and fresh selection.
3. [x] Project a same-target exact-key offer mismatch as a nonpayable conflict.
4. [x] Prove both same-offer and changed-offer request orderings.
5. [x] Run scoped verification and the product-experience recheck.

## Decisions

- The existing payer-scoped unique request key remains the serialization
  primitive; recovery miss creates no durable state.
- A later explicit click may change the selected offer but not the unresolved
  request identity.
- Offer-conflict presentation names the earlier winner for every purchase
  status and never presents the losing selection as fulfilled.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.config.ts
  apps/web/test/hosted-usage-credit-purchase-service.test.ts
  apps/web/test/hosted-usage-top-up-dialog.test.tsx
  apps/web/test/settings-billing-usage-credit-routes.test.ts --no-coverage`
  (197 tests passed)
- `pnpm --dir apps/web typecheck:prepared` (passed)
- touched-file ESLint (passed)
- `pnpm docs:drift` (passed)
- `git diff --check` (passed)
- product-experience recheck after the conflict-copy correction (`NO FINDINGS`)
- `pnpm test:diff apps/web packages/assistant-engine` (passed: affected
  package suites, 7,018 Web tests, full Web lint/dev smoke/build, and 2,016
  Cloudflare tests)
- ReviewGPT, exact-head acceptance, and CI remain PR-lane gates after this
  remediation plan closes.
Completed: 2026-07-28
