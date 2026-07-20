# Accept Stripe's expanded base-currency Price option

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Let Murph create hosted usage-credit Checkouts from the canonical reusable
  USD Prices while continuing to reject genuinely multi-currency Prices.

## Success criteria

- An expanded `currency_options.usd` entry for a USD Price is accepted when
  the Price's existing fixed-amount invariants pass.
- Any additional currency option is rejected before Checkout creation.
- Focused tests, diff-scoped verification, the required coverage audit, CI,
  and ReviewGPT all pass before the live offer mappings are enabled.

## Scope

- In scope: the usage-credit Stripe Price verifier and its focused service
  tests.
- Out of scope: changing purchase eligibility, grant accounting, refund or
  dispute semantics, pricing amounts, tax collection, or the settings UI.

## Constraints

- Preserve the existing single-currency, one-time, fixed-amount invariant.
- Add no new state, compatibility layer, provider abstraction, or dependency.
- Keep live Vercel offer mappings disabled until this fix is deployed and the
  required Stripe webhook events are configured.

## Tasks

1. Add a regression test for Stripe's expanded base-currency response.
2. Narrow the verifier to reject alternate currencies rather than the repeated
   base-currency entry.
3. Run focused and diff-scoped verification plus the required coverage audit.
4. Commit, open a PR, run CI and ReviewGPT, merge, then finish the Stripe and
   Vercel rollout with production proof.

## Verification

- Focused Vitest for the hosted usage-credit purchase service.
- `pnpm test:diff` for the changed source and test files.
- `git diff --check`, coverage audit, parent final review, PR CI, and ReviewGPT.

## Audit outcomes

- The coverage-write audit found the existing service-boundary proof
  sufficient and made no edits: the expanded base `usd` entry reaches an open
  Checkout, while the existing alternate `eur` case is rejected before
  Checkout creation.
- A read-only live Stripe Price retrieval confirmed the regression fixture's
  expanded USD fields match the provider response shape.
Completed: 2026-07-20
