# Match top-up usage grants to the subscription margin

Status: completed
Created: 2026-09-22
Updated: 2026-09-22

## Goal and success criteria

New top-up purchases allocate 80% of their cash subtotal to metered usage,
matching paid subscription allowances. Preserve cash prices, existing balances,
frozen purchase grants, payment retries, and proportional financial reversals.

## Owner and scope

The existing server-owned usage-credit offer catalog supplies purchase creation
and automatic group refills. Change its four grant values; reuse persisted
purchase terms and the existing fulfillment and ledger owners. No new runtime
logic, abstraction, dependency, schema, or migration is needed.

## Product UX

- Outcome: $5/$10/$20/$25 purchases grant $4/$8/$16/$20 of usage capacity.
- Entry and promise: existing personal, Family, group contribution, and capped
  sponsorship flows retain their cash prices and payment authorization.
- Affected people: new purchasers receive the new grants; existing balances and
  reserved purchases retain their original values, including delayed payments.
- Proof: catalog, purchase creation, automatic refill, fulfillment, refund,
  recovery, and product-contract tests, plus Web typecheck.
- Done when: new grants are saved correctly and both legacy and current frozen
  grants fulfill without recomputation. Presentation components are unchanged.

## Deployment and risks

Web-only catalog change. Older Web instances may reserve legacy grants during
deployment; newer instances honor those saved terms. Rollback preserves new
purchase grants while restoring old terms for subsequent purchases. No Stripe
Price update or balance migration. The 20% remainder is before payment fees,
other delivery costs, and possible admitted-work overshoot.

## Tasks

1. Update catalog and durable product contract.
2. Prove creation, refill, legacy/current fulfillment, and financial recovery.
3. Run focused checks, review the complete diff, and create a scoped commit.

## Verification

- Passed: seven focused Web test files, 366 tests covering offer amounts,
  purchase creation and retry, sponsorship refills, legacy/current ledger grants,
  payment reconciliation, refunds/disputes, product contract, and changelog loading.
  Command: `pnpm --dir apps/web test:prepared test/hosted-usage-credit-offers.test.ts test/hosted-usage-credit-purchase-service.test.ts test/hosted-group-sponsorship-authorization.test.ts test/hosted-execution-usage-credits.test.ts test/hosted-usage-credit-stripe-reconciliation.test.ts test/hosted-usage-top-up-product-spec.test.ts test/changelog-fragments.test.ts`.
- Passed: `pnpm --dir apps/web typecheck`.
- Passed: `pnpm complexity:diff`; no new complexity or current hotspots.
- Focused ESLint: zero errors; three pre-existing unused-parameter warnings in
  the sponsorship test harness. `git diff --check` and privacy checks passed.
- Parent review: four catalog grant changes; all consumers preserve immutable
  cash/grant terms. No new calls, foreground work, or provider-input changes.
- Product UX: Ready for the scoped catalog change. Payment prices, permissions,
  recovery, and existing capacity are preserved. Public changelog copy documents
  the new allowance; no presentation component changed.
- Local implementation only; no production mutation, deployment, or PR requested.
  PR-stage exact-head CI and billing ReviewGPT remain delivery gates before merge.

Completed: 2026-09-22
