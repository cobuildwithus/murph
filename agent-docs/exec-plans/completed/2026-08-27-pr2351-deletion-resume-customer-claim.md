# Resume exact Customer claims from account deletion

Status: completed
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Let retrying account deletion advance an already-committed exact
  `member.customer-create` claim without ever admitting a new Customer effect.

## Success criteria

- Deletion resumes only the exact existing Customer claim with the established
  Stripe idempotency key, then re-enters ordinary deletion target capture.
- No claim or an unrelated claim never causes Customer creation.
- Stripe failure keeps the exact claim, leaves the member unsuspended, and
  returns a truthful retryable deletion error.
- Successful replay binds and clears the claim before normal Customer cleanup.

## Scope

- In scope: the existing Customer effect owner, deletion preflight before
  suspension, focused unit and real-PostgreSQL proof, and matching operations
  documentation.
- Out of scope: new persisted state, queues, workers, claim expiry, leases,
  reclaimers, generic effect managers, Portal cutover, and deployment.

## Constraints

- Technical constraints: resume-only means no provider call unless the exact
  claim is already present; preserve stable idempotency and all short database
  transactions; never suspend before replay converges.
- Product/process constraints: the accepted round-3 finding is the complete
  mutation authority; stop again on any new final finding and keep the PR draft
  because the Portal cutover/drain remains unsatisfied.

## Risks and mitigations

1. Risk: reusing ordinary ensure semantics creates a Customer during deletion.
   Mitigation: expose a private-domain resume operation that requires the exact
   claim and returns a no-op/rejection when it is absent or unrelated.
2. Risk: replay failure partially suspends or clears ownership.
   Mitigation: run resume before deletion suspension and retain the claim across
   provider failure exactly as the current owner does.

## Tasks

1. [x] Map the existing deletion entry and Customer claim owner boundaries.
2. [x] Add the smallest exact-claim resume operation and call it before deletion
   suspension.
3. [x] Add focused no-create, unavailable-provider, successful-replay, and
   end-to-end deletion proof.
4. [x] Verify the candidate and package the exact implementation for the
   existing PR; same-thread ReviewGPT and required CI remain PR-level gates.

## Decisions

- Accept round 3: a committed ambiguous Customer effect is safe but not live if
  the initiating funding request disappears. Account deletion is the existing
  user-visible retry owner that must advance only that exact effect.
- Preserve one effect implementation and one cleanup owner. Deletion may invoke
  a resume-existing-only entrypoint but may not create, clear, or independently
  interpret the Customer claim.

## Verification

- Commands to run: focused Customer/deletion Vitest, real PostgreSQL
  interleavings, Web typecheck, focused ESLint, hosted-billing guard, docs drift,
  diff/privacy checks, current-base merge-tree, exact-head ReviewGPT, and CI.
- Expected outcomes: identical idempotency on replay; successful bind/clear then
  ordinary cleanup; unavailable Stripe remains retryable with no suspension;
  absent or unrelated claim performs no provider call.

## Results

- The Customer owner unit suite passes 13 tests, including absent, unrelated,
  ambiguous-success, and provider-unavailable resume boundaries.
- The account-deletion service suite passes 135 tests and proves recovery
  failures remain retryable before suspension.
- The real PostgreSQL suite passes 40 tests and proves abandoned-claim replay,
  stable provider identity, bind/clear, suspension ordering, and final Customer
  cleanup through the production deletion entrypoint.
- Prepared Web typecheck, focused ESLint, the hosted-billing CI guard, docs
  drift, diff checks, and current-base merge-tree proof pass. The PR remains
  draft pending exact-head ReviewGPT and required CI, and cannot merge until the
  separate Portal retirement and drain precondition is satisfied.
Completed: 2026-08-27
