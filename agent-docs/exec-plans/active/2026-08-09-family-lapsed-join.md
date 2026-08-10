# Allow lapsed subscribers to join Murph Family

Status: active
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Let a person whose individual Murph subscription is genuinely lapsed accept
  an active Murph Family invitation without manually canceling a dormant Stripe
  subscription first.
- Preserve the invariant that a sponsored Family member cannot silently retain
  a live direct subscription that could still bill or grant individual access.

## Success criteria

- A member with a stored direct subscription reference and `paused` own-billing
  status can accept a valid Family invite through the canonical acceptance
  owner.
- Members with a bound direct subscription in any status other than explicitly
  lapsed `paused` or `canceled` remain blocked by the recoverable transfer
  guard, including a Checkout binding whose status projection is still
  `not_started`.
- The lapsed-status exception applies only to invite acceptance; Family owner
  activation and management keep their existing stricter guard.
- Family sponsorship and a stale paused-plan resume serialize on the member
  lock: Family-first performs no Stripe mutation, while resume-first commits
  an `incomplete` own-billing fence before any Stripe mutation.
- A paused-plan request never publishes `active` from a Stripe resume response;
  paid-invoice reconciliation remains the sole authority for that promotion.
- Existing Family membership, identity binding, seat-capacity, activation, and
  Stripe loser-cleanup behavior remains unchanged.
- The focused Family-plan regression suite, hosted billing guard, Web
  typecheck, and Web lint pass locally; exact-head PR CI is green.
- The preliminary ReviewGPT product-experience and coverage lenses and the
  separate final ReviewGPT billing gate return with no unresolved accepted
  findings.

## Scope

- In scope:
  - Correct the direct-subscription liveness predicate at the existing Family
    invite-admission boundary.
  - Preserve Family sponsorship when it races a stale direct paused-plan resume
    and execute any resulting invoice-owned cleanup outcome.
  - Add focused regression coverage for lapsed and genuinely live statuses.
  - Clarify the live-direct-subscription rule in the Family product contract.
- Out of scope:
  - Changing Stripe subscription state during invite acceptance.
  - Adding a new transfer workflow, queue, billing state, or UI screen.
  - Repairing or mutating production account or invite rows.

## Constraints

- Technical constraints:
  - `hosted_member.billing_status` remains the member's own Stripe projection;
    Family access stays derived from the existing membership/group owner.
  - Provider calls remain outside the invite-claim transaction.
  - The existing receipt-owned reconciliation path remains responsible for any
    later direct-subscription race or cleanup.
- Product/process constraints:
  - Joining should remain one explicit accept action with no cancellation chore
    for a plan that no longer grants access or bills.
  - No private production evidence or identifiers may enter repository files,
    commits, PR text, or ReviewGPT packets.
  - Use an isolated worktree, exact-head PR lane, focused local proof, and the
    required ReviewGPT specialist/final gates.

## Risks and mitigations

1. Risk: A still-payable direct subscription is misclassified as lapsed and the
   member receives overlapping Family sponsorship.
   Mitigation: Admit only terminally non-live own-billing statuses while keeping
   active, incomplete, past-due, and unpaid coverage fail-closed.
2. Risk: A dormant provider object later changes after Family acceptance.
   Mitigation: Preserve the existing active-sponsorship reconciliation and
   exact-subscription cleanup owners; do not add a second cleanup lifecycle.
3. Risk: A shared liveness helper changes adjacent Family owner or management
   behavior.
   Mitigation: Pass the paused exception only from invite acceptance and prove
   that a paused direct owner remains blocked from capacity management.
4. Risk: A stale Settings or assistant resume action restarts direct billing
   after Family sponsorship.
   Mitigation: Re-read the Family claim under the existing member mutation lock,
   commit a blocking projection in a short database-only phase before provider
   mutation, and retain it until invoice-owned reconciliation resolves billing.

## Tasks

1. Record redacted production and code-path evidence for the root cause.
2. Add a focused failing regression for a paused direct subscription and expand
   the live-status matrix where necessary.
3. Correct the existing direct-subscription liveness predicate and update the
   Family product contract.
4. Run focused tests, Web typecheck/lint, the hosted billing guard, and inspect
   the complete diff for privacy and scope.
5. Commit and push the exact candidate, open the PR, and run preliminary and
   final ReviewGPT gates concurrently with CI.
6. Resolve accepted findings, rerun affected proof, perform the parent final
   review, close this plan with `scripts/finish-task`, and push the final head.

## Decisions

- The current owner is the Family invite-acceptance transaction in
  `apps/web/src/lib/hosted-onboarding/family-plan.ts`.
- Production evidence shows the affected account's own billing projection is
  `paused`, its stored period has ended, and only the dormant subscription
  reference causes the current `status !== canceled` predicate to classify it
  as live.
- The preliminary specialist review proved that direct Checkout can bind its
  subscription before the own-billing status projection advances from
  `not_started`. The smallest durable correction is therefore fail-closed:
  only bound `paused` and `canceled` subscriptions are explicitly lapsed; every
  other bound status remains live or ambiguous. The invite-admission correction
  itself requires no new state or provider call.
- The final ReviewGPT gate identified that the shared predicate also governs
  Family owner operations and that a stale paused-plan resume could race Family
  sponsorship. The exception is now invite-only. Resume and invite acceptance
  share the member lock, and paid-invoice reconciliation delegates any Family
  loser cleanup to the existing cleanup owner.
- Final ReviewGPT round 2 found that the first resume remediation still placed
  the fence and provider call in one rollbackable transaction. A successful
  Stripe resume could therefore survive while both local writes rolled back to
  `paused`, admitting a waiting Family claim. This is the same provider/local
  ordering mechanism, so the required anomaly retrospective was recorded on
  the PR before further implementation.
- Retrospective decision: redesign by deleting the provider-inclusive
  transaction and request-path provider-status projection. The existing
  `incomplete` value is committed under the member lock before Stripe is
  mutated; ordinary retry can resume an interrupted attempt from canonical
  Stripe `paused`, and invoice reconciliation alone can publish `active`. This
  adds no persisted state, queue, lifecycle owner, or invite-side provider call.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-family-plan.test.ts`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-billing-start-paid-pulse-service.test.ts`
  - `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_dev_family_lapsed_join MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-stripe-webhook-entitlement-postgres.test.ts -t 'rejects Family acceptance after Checkout binds before status projection|keeps Family blocked when a paused-plan resume succeeds after its fence transaction'`
  - `pnpm hosted-billing:ci-guard`
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir apps/web lint`
  - `git diff --check` and secret-safe final diff inspection
- Expected outcomes:
  - Paused/lapsed invite acceptance passes; live or ambiguous direct statuses
    and paused direct Family owners remain blocked.
  - Family-first blocks stale resume without Stripe mutation; resume-first
    commits `incomplete` before Stripe and never request-projects `active`;
    paid-invoice cleanup is not discarded.
  - Billing request-shape/contract guards, typecheck, and lint remain green.
  - No new persisted state, external call, dependency, or UI surface appears.
