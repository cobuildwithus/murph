# PR 996 round-2 database remediation

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Resolve the accepted final ReviewGPT round-2 finding by making the validated
  PostgreSQL contract accept the sessionless fulfilled-payer detachment shape
  already required by the direct saved-card lifecycle.

## Success criteria

- A forward predeploy migration replaces only
  `hosted_usage_credit_purchase_active_payer_required` with a backward-compatible
  fulfilled arm that requires terminal, reconciliation, paid,
  PaymentIntent-lookup, and Charge-lookup proof without inventing Checkout
  Session proof.
- The existing deleted-payer ciphertext-cleared constraint and every
  non-fulfilled status arm remain unchanged.
- A migrated-PostgreSQL regression runs the real account-deletion detachment
  transaction for a fulfilled direct purchase and proves invalid payerless
  direct proof still fails at the database boundary.
- Focused and canonical verification, exact-head CI, and final ReviewGPT
  correction verification pass before PR 996 leaves draft.

## Constraints

- Add no compatibility state, feature flag, queue, dual write, or parallel
  lifecycle owner.
- The schema relaxation must deploy before the application head can persist the
  newly accepted sessionless detached shape.
- Preserve ordinary expand-only migration enforcement; any predeploy exception
  must be exact and limited to this proved backward-compatible constraint
  relaxation.

## Tasks

1. Add the forward constraint-relaxation migration and the narrow predeploy
   guard proof.
2. Add real migrated-PostgreSQL detachment and invalid-proof regressions.
3. Align current architecture, security, reliability, verification, and
   deployment documentation.
4. Run scoped and canonical verification, close this plan with a scoped commit,
   push the existing branch, and run ReviewGPT round 3 with CI.

## Outcome

- Added a forward predeploy migration that replaces the strict detached-payer
  constraints with the sessionless direct-payment proof while preserving every
  other status and ciphertext requirement.
- Kept the historical postdeploy installer immutable but removed it from the
  live contract-migration list so it cannot re-tighten the schema after
  promotion.
- Proved a zero-state Prisma migration, the real account-deletion transaction,
  valid sessionless detachment, and database rejection when either the
  PaymentIntent or Charge lookup is missing.
- Focused migrated-PostgreSQL verification passed 225 tests. The web TypeScript
  check and touched-file ESLint completed with no errors; ESLint retained one
  unrelated existing unused-variable warning.
- Canonical `pnpm test:diff` passed in Blacksmith testbox
  `tbx_01kygx42yv98vxhckd7h0hd55c`, and canonical
  `pnpm verify:acceptance` passed in testbox
  `tbx_01kygx8svrv8npvkz2hhx3ebkp`.
Completed: 2026-07-27
