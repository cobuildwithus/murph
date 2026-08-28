# Serialize owner-created group funding with account deletion

Status: completed
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Prevent owner-created join-code funding checkout from deadlocking with
  terminal account deletion while preserving every existing funding and
  suspension authority check.

## Success criteria

- Owner-created group funding locks the existing group/container rows before
  the beneficiary member row.
- Signed funding-only locators retain their current container/member path.
- Both real-PostgreSQL start orders settle without `40P01`.
- When deletion wins, checkout creates no purchase, sponsorship authorization,
  sponsorship moment, or Stripe Checkout session after suspension.
- Focused unit and PostgreSQL tests, hosted Web typecheck, lint, and repository
  diff/privacy checks pass on the exact pushed head.

## Scope

- In scope: owner-created join-code admission ordering in the existing usage
  credit purchase owner and focused regression proof against account deletion.
- Out of scope: signed funding-only locator behavior, retries, queues, new state,
  lock managers, schemas, dependencies, or broader billing/deletion redesign.

## Constraints

- Technical constraints: reuse the existing group/container `FOR SHARE` read,
  keep transactions database-only, preserve bounded transaction options, and
  do not move Stripe or KMS work under new locks.
- Product/process constraints: a funding attempt must either precede deletion
  under the canonical locks or fail before accepted billing effects after
  suspension; preserve explicit payment confirmation and recovery behavior.

## Risks and mitigations

1. Risk: moving the group lock could accidentally alter signed funding-only
   locator behavior.
   Mitigation: gate the early lock strictly on the owner-created join-code
   branch and retain the signed-locator query unchanged.
2. Risk: a unit test could prove query order without exercising PostgreSQL
   contention.
   Mitigation: compose the production checkout and deletion owners with two
   real clients and explicit lock barriers in both start orders.

## Tasks

1. Record the requirement retrospective and prove the lock cycle in current
   production paths.
2. Reorder and reuse the existing owner-created group/container share lock.
3. Add focused unit ordering proof and real-PostgreSQL interleaving proof.
4. Run focused verification, inspect the diff, finish the plan, commit, push,
   and complete exact-head ReviewGPT, CI, merge, deploy, and cleanup gates.

## Decisions

- Continue the current PR: the finding protects the original group-before-member
  invariant and needs only an owner-local reorder.
- Reuse the existing query and transaction owner; add no coordination machinery.

## Verification

- Commands to run: focused usage-credit unit tests; focused group/deletion
  PostgreSQL tests; hosted Web prepared typecheck; focused ESLint;
  `pnpm docs:drift`; manual privacy inspection; and `git diff --check`.
- Expected outcomes: all focused proofs pass, both contenders settle without
  `40P01`, and the deletion-first case has no accepted billing effects.

## Results

- All 204 usage-credit purchase-service tests passed.
- Both focused real-PostgreSQL account-deletion/funding start orders passed.
- Hosted Web prepared typecheck, focused ESLint, docs drift, diff, and privacy
  inspection passed.
- The broader PostgreSQL file passed 33 of 37 tests in the fresh isolated
  database; four unrelated crypto-authority fixtures require local envelope
  setup and failed before reaching the changed paths.
Completed: 2026-08-27
