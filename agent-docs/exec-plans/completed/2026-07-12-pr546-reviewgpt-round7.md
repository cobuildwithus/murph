# PR 546 ReviewGPT round 7 remediation

Status: completed
Created: 2026-07-12
Updated: 2026-07-12

## Goal

- Close the four exact-head ReviewGPT round 7 findings with existing billing
  owners and retry journals, then repeat audits, verification, exact-head
  review, CI, and merge PR 546.

## Success criteria

- An exact historical Pulse loser on another Stripe customer is cleanup-only
  when a distinct durable active subscription exists, while cross-customer
  recovery remains prohibited.
- Auto-enrollment loser cleanup is rediscovered from exact provider metadata
  on retry, preserves the durable winner, treats absent/already-canceled losers
  as terminal, and exposes retryable cancellation failure.
- A delayed Pulse Checkout losing to any distinct active durable subscription,
  including standard paid billing, is canceled before its receipt completes.
- No continuation advances beyond a page containing unresolved work.
- Required audits, full verification, exact-head ReviewGPT, and final-head CI
  pass before merge.

## Constraints

- Reuse the existing member lock, Stripe receipt journal, exact subscription
  metadata, and campaign disposition owner.
- Do not add a cleanup table, queue, persisted campaign state, or another
  billing writer.
- Preserve current paid billing and retry-safe idempotency.

## Tasks

1. Carry cross-customer exact provider obligations through projection and gate
   recovery unless the locked disposition is cleanup-only.
2. Derive auto-enrollment loser cleanup from a fresh bounded Stripe list before
   returning an existing durable enrollment.
3. Broaden delayed Pulse Checkout loser classification from redeemed-only to
   any distinct active durable subscription.
4. Suppress page continuation on lock, runway, stale-proof, provider, or local
   write failures and keep the current page retryable.
5. Add production-path regressions, rerun required audits and verification,
   commit, push, ReviewGPT, CI, reconcile main, and merge.

## Decisions

- Accept all four findings after tracing the provider projection, enrollment
  early return and cancellation error semantics, Checkout receipt completion,
  and page-level cursor construction.
- Accept the payment re-audit's shared race class: exact-loser cancellation
  must share the member lock with a fresh durable-owner proof, and cleanup
  requires a concrete distinct current subscription. Reuse the existing
  provider-aware member mutation lock instead of adding cleanup persistence or
  another lock owner.
- Accept the frontend re-audit's failed-page copy finding so the member flow
  asks the operator to retry the current batch instead of referring to a
  disabled continuation action.

## Verification

- Focused Vitest: 6 files, 205 tests passed after the lock, retry, Checkout,
  continuation, and frontend coverage additions.
- Focused ESLint: passed with zero warnings.
- Prepared apps/web typecheck: passed.
- Required security/payment re-audit: clean after the accepted lock,
  distinct-winner, and provider-aware transaction-budget corrections.
- Required coverage-write re-audit: clean; provider retry, ambiguous cleanup,
  resource-missing, winner preservation, receipt retry, and every failure
  continuation counter have direct proof.
- Required frontend/final re-audit: clean; 31 focused client tests passed.
- `pnpm test:diff apps/web`: passed on the definitive rerun, including dev
  smoke, production build/typecheck, 380 passing test files (4,372 tests, 9
  skipped), dependency/boundary/runtime guards, and lint with only existing
  unrelated warnings.
Completed: 2026-07-12
