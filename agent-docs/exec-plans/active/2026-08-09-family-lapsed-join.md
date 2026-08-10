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
- Members with active, incomplete, past-due, or unpaid direct subscriptions
  remain blocked by the recoverable transfer guard.
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
3. Risk: The fix changes adjacent owner-conversion behavior.
   Mitigation: Change only the shared liveness predicate and exercise invitee
   admission plus existing live-status cases in the focused owner suite.

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
- The smallest durable correction is to derive liveness from the closed set of
  own-billing statuses that can still represent a payable or access-bearing
  direct subscription. No new state or provider call is required.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-family-plan.test.ts`
  - `pnpm hosted-billing:ci-guard`
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir apps/web lint`
  - `git diff --check` and secret-safe final diff inspection
- Expected outcomes:
  - Paused/lapsed acceptance passes; live direct statuses remain blocked.
  - Billing request-shape/contract guards, typecheck, and lint remain green.
  - No new persisted state, external call, dependency, or UI surface appears.
