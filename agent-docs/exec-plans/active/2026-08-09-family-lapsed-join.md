# Allow lapsed subscribers to join Murph Family

Status: active
Created: 2026-08-09
Updated: 2026-08-10

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
- The lapsed-status exception applies only to invite acceptance; it does not
  broaden the separately authorized Family-owner activation/capacity paths or
  member-tier management.
- Family sponsorship and a stale paused-plan resume serialize on the member
  lock: Family-first performs no Stripe mutation, while resume-first commits
  an `incomplete` own-billing fence before any Stripe mutation.
- A paused-plan request never publishes `active` from a Stripe resume response;
  paid-invoice reconciliation remains the sole authority for that promotion.
- A paused subscription receipt cannot erase a committed resume fence or its
  target; the existing billing-plan projection durably owns the first
  Pulse/Core choice before provider access.
- A paid or deleted provider receipt that wins before the locked claim remains
  authoritative: paid exact-target replay is idempotent, a different target is
  stale, and terminal cancellation leaves the member eligible for Family.
- Paid-invoice activation requires the invoice line Price to match the
  canonical target subscription, not only the subscription identifier.
- The durable claim binds the validated claim-time Stripe Price before provider
  access. Exact retry and invoice settlement keep using that Price if the
  mutable catalog later points at a replacement Price.
- The direct recovery claim is committed before cardless payment setup, so
  Family-first returns no portal while direct-first remains exactly recoverable
  from Settings and assistant without a forced refresh.
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
  - Preserve the exact pending recovery actions in the existing Settings plan
    cards and assistant offer projection.
  - Label a paid Pulse claim as billing pending and avoid presenting a mutable
    catalog amount as already accepted while confirmation is incomplete.
  - Add focused regression coverage for lapsed and genuinely live statuses.
  - Clarify the live-direct-subscription rule in the Family product contract.
- Out of scope:
  - Changing Stripe subscription state during invite acceptance.
  - Adding a new transfer workflow, queue, billing status, UI screen, component,
    or lifecycle owner. One nullable claim-Price scalar is added to the existing
    billing reference because the accepted provider term cannot be derived from
    mutable catalog configuration.
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
   Mitigation: Pass the paused exception only from invite acceptance, keep
   owner-only allowances explicit at their existing call sites, and prove that
   live or ambiguous non-owner invitees remain blocked.
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
  sponsorship. The exception is now invite-only and remains distinct from
  explicit owner-only allowances. Resume and invite acceptance share the member
  lock, and paid-invoice reconciliation delegates any Family loser cleanup to
  the existing cleanup owner.
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
- Final ReviewGPT round 3 found three continuations of the same coupling gap:
  a paused receipt could move the fence backward; different paid targets did
  not share a provider transition claim; and recovery could open payment setup
  before the Family recheck or disappear behind generic Settings billing.
- Round 3 recurrence decision: keep `incomplete` monotonic for the exact
  Pulse-trial resume, use one target-independent deterministic Stripe cleanup
  key whose body owns the selected target, perform the Family recheck before
  any payment portal call, and reuse the existing pending confirmation UI and
  assistant offer. This adds no database field, lease, queue, or lifecycle
  owner.
- Final ReviewGPT round 4 proved that the round-3 continuation still left the
  target only in Stripe's bounded idempotency cache and released the member
  lock without a claim before cardless portal handoff. A Core receipt could
  therefore preserve `incomplete` while overwriting the local plan and deleting
  its exact recovery action; Family could also commit after the preflight and
  before the browser redirect.
- Round 4 requirement decision: the existing
  `hosted_member_billing_ref.current_billing_plan_code` owns the selected target
  while `billing_status=incomplete`. Commit both values under the member lock
  before either portal creation or provider mutation, preserve that target
  against intermediate receipts, and make Settings/assistant expose only its
  exact retry. Family-first returns no portal; direct-first remains a
  non-expiring, recoverable claim until invoice reconciliation. Automatic
  abandonment is intentionally excluded because expiring a possibly
  provider-mutated claim could admit overlapping sponsorship. This replaces
  provider-cache target ownership without a new field, queue, lease, enum, or
  lifecycle owner.
- Final ReviewGPT round 5 found that the exact-target fence still accepted an
  original trial binding after a paid or terminal receipt won, and that
  subscription identity alone let an older plan invoice confirm a different
  current target. It also found that Web kept pending state only inside the
  open dialog and offered a generic billing portal with a false `Cancel`
  affordance.
- Round 5 requirement decision: re-read the exact customer, subscription,
  status, phase, plan, suspension, and Family authority under the existing
  member lock before claiming. Admit only the original active-trial/paused
  source or exact incomplete target; treat the same active paid target as
  idempotent and every conflicting or terminal projection as authoritative.
  Require the invoice line Price to match the target, refresh canonical Web
  state on pending, preserve its exact recovery after dialog close, and remove
  the generic portal and false cancellation affordance. Real PostgreSQL
  paid-wins and deleted-wins interleavings cover both receipt orders without
  adding state or another lifecycle owner.
- Final ReviewGPT round 6 found that new Core admission and recovery of an
  existing exact Core claim still shared one membership check, so leaving the
  qualifying group after selection could strand the durable claim. It also
  found that a post-claim portal failure left stale actions visible until a
  manual reload and that the payment-method return contradicted the exact
  selected recovery with fresh-choice copy.
- Round 6 requirement decision: distinguish a new locked selection from an
  exact incomplete retry. Require membership and write the target only for the
  first selection; retain binding, suspension, Family, terminal, paid-target,
  and conflicting-target checks on recovery. Preserve request errors while
  refreshing canonical Web state, and derive the payment-method receipt from
  the existing billing projection so an exact Core claim points only to Check
  Core status. No new state, component, action, or lifecycle owner is added.
- Final ReviewGPT round 7 found that the non-expiring claim stored a plan code
  but not the exact immutable Stripe Price accepted at selection. A catalog
  rotation could therefore retry against new terms without consent or strand a
  provider transition already made at the old Price. It also found that an
  incomplete paid Pulse claim still displayed the `Free trial` ribbon.
- Round 7 requirement decision: persist the validated claim-time Price as one
  nullable scalar on the existing member billing reference in the same locked
  write as the target plan. Exact recovery skips validation against the mutable
  current catalog and uses the bound Price for provider mutation, idempotency,
  invoice proof, and final plan projection. A missing legacy binding fails
  closed before provider access. Pending Pulse is labeled `Billing pending`,
  and the pending status dialog omits the mutable current amount rather than
  implying reconfirmation. This adds no state owner, queue, lease, enum, action,
  or screen.
- The valid round-7 response reviewed exact head
  `74bf6d90f86f43d7c5001228a84f53c397510870` with the requested and returned
  GPT-5.6 Pro-class model and ended `FINDINGS`. The ReviewGPT tooling required
  two packaging retries before the successful send: the first packet used an
  invalid current-head full-snapshot anchor, and the second failed attachment
  staging before any review request was sent. Round 7 is the substantive-round
  hard cap; after remediating its findings, another final-gate round requires an
  explicit user continuation decision.
- The required Claude Code UI double-check was attempted against the final
  desktop/mobile catalog evidence and stopped on explicit Fable usage-credit
  exhaustion. Per the completion workflow, no second Claude request or local
  substitute was added.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-family-plan.test.ts`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-billing-start-paid-pulse-service.test.ts`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-stripe-billing-events.test.ts apps/web/test/hosted-onboarding-stripe-billing-status.test.ts apps/web/test/hosted-onboarding-billing-plans.test.ts apps/web/test/hosted-billing-settings.test.tsx apps/web/test/hosted-usage-status.test.ts apps/web/test/settings-page.test.ts`
  - `DATABASE_URL="$MURPH_DEV_DATABASE_URL" pnpm --dir apps/web prisma:migrate:deploy`
  - `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-stripe-webhook-entitlement-postgres.test.ts -t 'rejects Family acceptance after Checkout binds before status projection|keeps the Core recovery target and Family fence while a paused receipt races the resume response|rejects a delayed Core claim after Pulse paid reconciliation wins|preserves a deleted receipt against a delayed Core claim so Family can join|commits the direct recovery fence before opening card setup|recovers a claimed Core plan after group membership is removed'`
  - `pnpm hosted-billing:ci-guard`
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir apps/web lint`
  - `git diff --check` and secret-safe final diff inspection
- Expected outcomes:
  - Paused/lapsed invite acceptance passes; live or ambiguous direct statuses
    for non-owner invitees remain blocked, without changing explicit
    Family-owner allowances.
  - Family-first blocks stale resume without Stripe mutation; resume-first
    commits `incomplete` before Stripe and never request-projects `active`;
    a paused receipt cannot erase the fence; paid-invoice cleanup is not
    discarded.
  - Exact paused-plan retries reuse the target-specific provider claim;
    conflicting Pulse/Core choices fail stale before provider access, and only
    the claimed recovery remains visible in Settings and assistant output.
  - Initial Core selection still requires current group membership, while an
    exact claim remains recoverable after later membership loss and can settle
    only through its claim-time exact-price invoice, including after the current
    catalog Price changes.
  - Paid and deleted receipt winners cannot be overwritten by a delayed claim;
    exact-price invoice proof prevents cross-plan activation, and terminal
    cancellation permits the existing Family admission path.
  - Billing request-shape/contract guards, typecheck, and lint remain green.
  - No new state owner, external call, dependency, component, or UI screen
    appears. The only new persisted value is the accepted claim-time Price on
    the existing billing reference.
- Round 5 remediation proof on the local candidate:
  - Eight focused unit/UI files pass with 468 tests.
  - The five focused real-PostgreSQL orderings pass, including paid-wins and
    deleted-wins against a delayed Core claim.
  - Hosted billing CI guard and Web typecheck pass.
  - Full Web lint passes with zero errors; its 37 warnings are outside the
    changed files.
  - Desktop 1440 CSS px at 2x and mobile 390 CSS px at 3x catalog crops render
    the real pending confirmation state, pass native-resolution inspection,
    and match their hosted PNGs byte-for-byte.
  - `git diff --check` passes.
- Round 6 remediation proof on the local candidate:
  - Nine focused unit/UI files pass with 527 tests, including rejected-request
    refresh, saved-payment return branching, existing-claim recovery, and
    initial-selection rejection with no local or provider mutation.
  - Six focused real-PostgreSQL orderings pass. The new ordering commits a
    cardless Core claim while membership exists, removes the last membership,
    resumes the exact claim, and activates only through its matching invoice.
  - Hosted billing CI guard and Web typecheck pass. Full Web lint passes with
    zero errors; its 37 warnings remain outside the changed files.
  - Real-component portal-failure and payment-method-return states pass desktop
    and mobile native-resolution inspection. All four lossless hosted images
    are byte-identical to the inspected local captures.
  - `git diff --check` passes.
- Round 7 remediation proof on the local candidate:
  - Nine focused unit/UI files pass with 530 tests, including immutable
    claim-Price recovery, mismatched invoice rejection, exact old-Price invoice
    settlement after catalog rotation, the paid-Pulse pending label, and the
    absence of a current-price reconfirmation in the pending dialog.
  - The additive migration applies cleanly to the isolated worktree database.
    All six focused real-PostgreSQL orderings pass; the exact Core recovery
    ordering now rotates the configured catalog Price after selection and still
    resumes and settles only the claim-time Price.
  - Hosted billing CI guard and Web typecheck pass. Full Web lint passes with
    zero errors; its 37 warnings remain outside the changed files.
  - Real-component paid-Pulse pending and portal-failure states pass desktop and
    mobile native-resolution inspection. All four hosted lossless images are
    byte-identical to the inspected local captures.
  - Product-experience revalidation finds no remaining changed-journey finding:
    the lapsed invite remains one accept action, while incomplete direct billing
    exposes one truthful exact-status recovery without a cancel chore, alternate
    plan choice, false trial label, or mutable-price implication.
  - `git diff --check` passes.
