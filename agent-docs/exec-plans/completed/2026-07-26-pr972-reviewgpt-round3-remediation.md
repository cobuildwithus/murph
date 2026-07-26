# PR 972 ReviewGPT Round 3 Remediation

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Resolve the two qualifying ReviewGPT round 2 findings without adding billing
  state, a second reconciliation owner, or a generalized deletion lifecycle.

## Scope

- Current-period Stripe update-invoice funding attribution across cumulative
  quantity increases, true unwinds, and same-price item consolidation.
- Replayed reservation Customer safety validation before any direct or Family
  Checkout expiration, cancellation, or refund.
- Focused regressions, canonical verification, PR evidence updates, and
  correction-only ReviewGPT round 3.

## Constraints

- Derive recurring funding from bounded authoritative Stripe invoice history.
- Keep item consolidation identity-neutral and discard an older invoice only
  when a later paid transition economically unwinds its contribution.
- Keep the reservation-only safety policy narrow; ordinary known Customers
  retain the established account-deletion cleanup path.

## Tasks

1. Reproduce both findings through their production owners with focused tests.
2. Replace latest-snapshot matching with the smallest bounded chronological
   derivation that preserves still-represented paid deltas.
3. Run recovered-reservation safety validation immediately after recovery and
   before either Checkout reconciliation owner.
4. Run focused tests, Web checks, canonical diff verification, and acceptance.
5. Finish the plan in a scoped commit, push, update PR evidence, and run
   correction-only ReviewGPT round 3 concurrently with CI.

## Evidence

- ReviewGPT round 2 completed against
  `76b95754a14b02a7e1d687cfff348bb675bd8453` and reported two qualifying
  review-induced findings.
- Focused regressions reproduced both findings before implementation:
  cumulative and consolidated subscription updates lost still-required funding,
  and recovered-reservation deletion reached direct and Family Checkout effects
  before the Customer mismatch guard.
- The corrected focused Vitest lane passed 134 tests across the Stripe billing
  lookup and account-data service suites.
- Scoped ESLint, `pnpm typecheck:prepared`, `git diff --check`, and the private
  identifier scan passed.
- Canonical diff verification passed in Testbox
  `tbx_01kyg74ymfazvqt1a91brbvwhf` with its GitHub Actions mirror
  `30222276543`, including 7,157 passing Web tests and the production build.
- Full `pnpm verify:acceptance` passed in Testbox
  `tbx_01kyg796anzmrv8xc0medsbc4t` with its GitHub Actions mirror
  `30222362809`.
Completed: 2026-07-26
