# Recover And Land Mixed-Tier Hosted Family Billing

## Goal

Recover the lost mixed-tier Family implementation from Codex session artifacts,
reconcile it onto current `main`, and open a verified PR that lets one Family
group reserve and assign Pulse and Edge independently while keeping one Stripe
customer, subscription, and invoice.

## Constraints

- Treat the archived session as recovery evidence, not authority over current
  code. Re-prove every affected ownership and invariant boundary on current
  `main`.
- Keep Family as a payer/access context, not a third product tier.
- Model exact typed capacity per tier; do not add cumulative uplift products,
  per-member Stripe subscriptions, or a generic Stripe-item mirror.
- Preserve reserved-capacity semantics: active memberships and live invites
  consume exact typed capacity, and removal frees capacity without silently
  changing the bill.
- Keep direct billing and active Family sponsorship mutually exclusive.
- Stripe remains canonical for paid quantities and payment state. Hosted
  Postgres stores member/invite tier assignment and the validated Family
  capacity projection needed by product reads.
- Use expand/backfill/switch sequencing that is safe across web deploy skew.
- Preserve unrelated work and do not change or depend on PR #553.
- Do not deploy or mutate live Stripe state.

## Recovery Source

- Root Codex session: `019f48ca-f86a-7740-a83e-1337f59302ed`.
- Original base commit: `46863ed41d8b29a05f171fa12912e26988f10774`.
- Recover root patches and delegated frontend edits into a detached archival
  reconstruction, then port the resulting intent onto current `main`.

## Plan

1. Reconstruct the archived final worktree state from root and delegated
   session artifacts and inventory the complete changed-file set.
2. Compare the recovered state with current `main`, retaining only behavior
   still required and adapting to current owners and contracts.
3. Add or update schema, migration, tier/offer catalogs, Family capacity and
   assignment logic, owner routes/UI, shared entitlement resolution, specs,
   and focused tests.
4. Run focused checks, Prisma validation, truthful diff verification, and
   direct mixed-tier scenario proof.
5. Complete security/privacy, frontend, and coverage audit passes and resolve
   every accepted finding.
6. Close this plan with `scripts/finish-task`, push the branch, open the PR,
   and run CI plus ReviewGPT concurrently on the exact pushed head.

## Verification

- Focused hosted Family, billing, usage, route, metrics, privacy, migration,
  and settings tests selected from the final diff.
- `pnpm test:diff <changed paths...>` or `pnpm verify:acceptance` as selected by
  the current verification matrix.
- Prisma format/generate plus migration/schema contract validation.
- Direct scenario proof for mixed Pulse/Edge capacity, local reassignment into
  open capacity, paid capacity conversion, Stripe reconciliation, and failure
  recovery.
- Desktop and mobile browser proof for the owner settings flow.
- Required `security-privacy-review`, `frontend-review`, and `coverage-write`
  passes, followed by parent final review.
- Exact-head ReviewGPT pass, green CI, and mergeability proof.

## State

Complete locally. The recovered implementation is rebased onto current
`origin/main` and keeps one shared product-tier type, an exact per-tier
capacity projection owned by Stripe webhook reconciliation, and no generic
persisted billing-operation model. The changed web suite, full hosted-web
suite, assistant Family/model-budget suites, hosted-execution parser suite,
affected package typechecks, and all repository guards pass. Security/privacy,
frontend, and coverage-write audits have no remaining findings; coverage-write
added one service-level mixed-tier Stripe-composition regression.

The shared `test:diff` retry passed the branch-owned checks and full
assistant-engine suite, then reached unchanged CLI tests whose source-test
route expected a missing built `packages/core/dist/index.js`; subsequent
unchanged CLI lock/runtime tests exhausted their 60-second timeouts. This task
does not change `packages/core` or `packages/cli`, so that harness/build
precondition remains outside this Family billing scope. Browser proof was not
available because the managed browser inventory was empty. The remaining gates
are the pushed-head PR CI and ReviewGPT loop.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
