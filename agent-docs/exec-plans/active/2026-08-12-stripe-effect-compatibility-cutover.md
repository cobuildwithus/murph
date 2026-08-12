# Stripe effect compatibility cutover

Status: active
Updated: 2026-08-12

## Goal

Land the schema-expand and compatibility release that makes every deployed
legacy member and Family Stripe admission refuse the durable effect claims
introduced by later billing-owner releases.

Success means this release writes no claim, changes no Stripe request shape,
and can be deployed and fully drained before any claim-enabled Web revision.

## Scope

- Add the final nullable member and Family claim scalars needed by the later
  member, Family-capacity, and sponsored-cleanup owners.
- Add one read-only member assertion and one read-only Family assertion, then
  reuse them at legacy billing and relationship admission boundaries.
- Fence account deletion under the same member rows used by later claims.
- Document and prove the deploy, convergence, drain, rollback-floor, and
  eventual compatibility-removal sequence.
- Do not write or reconcile a claim, move a provider request, or implement the
  later member, Family, or sponsored effect owners.

## Invariants

- The migration is additive, nullable, and performs no table rewrite, backfill,
  index build, or collection fanout.
- Every legacy admission that could mutate the same Stripe or relationship
  authority fails retryably when the corresponding future claim exists.
- The assertion runs only after the owning member row is locked; no provider
  request or durable authority mutation occurs after a claim is observed.
- Existing no-claim behavior and Stripe request construction are unchanged.
- This revision deploys alone and fully drains before a later revision may
  persist its first claim.

## Implementation

1. Add the final nullable member/group claim scalars in one additive migration.
2. Add minimal read-only compatibility assertions in the existing member and
   Family billing owners.
3. Apply the assertions to direct Checkout, Customer creation, portal upgrade,
   scheduled plan switch, Family Checkout/direct conversion/capacity/tier,
   sponsored cleanup, Family relationship writers, and account deletion.
4. Add unit and real-PostgreSQL barriers proving future claims beat waiting
   legacy writers without provider entry or partial authority mutation.
5. Update owner and verification documentation with the exact rollout contract.
6. Run focused checks, exact-head CI, specialist review, final ReviewGPT, and
   the normal draft-PR completion loop.

## Removal condition

Compatibility assertions may be removed only after the member, Family, and
sponsored claim owners are all deployed; every Web revision and in-flight
invocation older than this cutover is unable to run; and no supported rollback
target predates this cutover. After the first claim is persisted, this revision
is the hard rollback floor and incident recovery below it is prohibited.

## Progress

- [x] Preserve the rejected aggregate prototype as a local non-pushed review
  checkpoint and validate the deploy-skew counterexample.
- [x] Create this sanctioned worktree from exact base `05988dd160`.
- [x] Add the read-only expand and compatibility implementation.
- [x] Prove unit, migration, and real-PostgreSQL mixed-version barriers.
- [x] Run focused/type/lint/guard/docs/privacy/diff gates.
- [x] Publish draft PR #1750.
- [x] Merge current `origin/main` exactly once after prevalidating the only two
  conflicts as mechanical documentation-index and migration-inventory unions.
- [ ] Complete exact-head CI plus zero-actionable specialist and final
  ReviewGPT rounds.

## Verification evidence

- Focused member, Family, sponsored-cleanup, and deletion coverage passed 494
  tests; the account-deletion slice passed 101 tests after adding the immutable
  beneficiary-scalar fence.
- A fresh isolated loopback PostgreSQL database applied all 179 Web migrations.
  The member-lock suite passed 30 tests, including committed future claims
  defeating waiting direct-customer, Family-capacity, Family-authority, owner
  deletion, active-beneficiary deletion, and immutable-claim-beneficiary
  deletion writers without provider entry or partial suspension.
- The production and privacy migration guards passed 63 tests. Prisma
  validation, Web typecheck, Web lint, hosted-billing CI, provider-request,
  documentation drift, and documentation gardening checks passed.
- Canonical diff verification reached all 769 Web test files and 10,099 tests.
  It found only four missing methods in focused Family/Telegram test doubles;
  9,693 tests passed and 402 were skipped. After fixture-only corrections, the
  exact files passed 53 tests, the broader Family/Telegram slice passed 289
  tests, focused lint passed, and Web typecheck passed.
- The first specialist and final ReviewGPT submissions were diagnostic-only:
  both targeted pre-merge head `80e8555638` while the PR was already
  non-mergeable, then terminated during response capture. They establish no
  review baseline. Fresh reviews will target the clean merged head.
- After the one-time base merge, a fresh loopback database applied all 180 Web
  migrations. The 30-case PostgreSQL barrier suite passed after its test-only
  crypto provider double was brought up to the current signing contract; no
  production owner or provider request changed.
