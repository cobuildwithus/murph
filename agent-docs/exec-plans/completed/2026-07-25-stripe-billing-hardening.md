# Stripe Billing Hardening

Status: completed
Created: 2026-07-25
Updated: 2026-07-26

## Goal

- Make recurring Stripe billing transitions converge safely across synchronous
  requests, webhook retries, payment authentication, terminal invoice states,
  refunds, disputes, and Family ownership changes without granting entitlement
  early, retaining duplicate charges, or introducing a second billing owner.

## Success criteria

- Pulse Trial resume and paid-start flows attach a correctly typed saved tender
  through a supported Stripe mutation before resuming, and classify terminal or
  actionable collection states without indefinite `billing_pending`.
- Retry identity reuses one provider request only while its canonical Stripe
  precondition is unchanged and rotates after Stripe proves the prior attempt
  terminal.
- Standard subscription Checkout accepts at most one current subscription per
  member; a superseded completion is left unbound and its subscription and paid
  invoice are cleaned up through the existing serialized owner path.
- Direct-to-Family conversion preserves direct ownership until the paid Family
  item shape is canonical, and Family capacity changes expose authentication or
  payment recovery without granting unpaid seats.
- Refunds and disputes resolve the exact member or Family owner from canonical
  Stripe objects, account for cumulative successful refunds, and reconcile from
  all relevant lifecycle events.
- Scheduled downgrade and Billing Portal paths reject unsupported or mutable
  production configuration rather than disguising deterministic integration
  errors as transient provider failures.
- Focused regressions cover the repaired state transitions, canonical Web
  verification and acceptance pass, and the exact pushed PR head clears the
  required preliminary specialist, ReviewGPT, and CI gates.

## Scope

- In scope:
  - recurring member and Family Checkout, resume, paid-start, plan-change,
    capacity-change, transfer, refund, dispute, invoice, and webhook
    reconciliation paths in `apps/web`
  - the smallest Settings recovery behavior needed to follow a Stripe-hosted
    payment URL returned by those owners
  - current billing product/architecture documentation and focused tests
- Out of scope:
  - custom card collection or Payment Element UI
  - a generic billing framework, local invoice ledger, timer, cron, or second
    entitlement state machine
  - usage-credit purchase accounting except where shared webhook dispatch must
    preserve its existing precedence
  - unrelated Stripe cleanup already owned by another active PR lane

## Constraints

- Technical constraints:
  - Stripe remains canonical for subscription, invoice, payment, refund, and
    dispute facts; Postgres remains the only Murph billing projection owner.
  - Positive entitlement changes continue through canonical reconciliation.
  - Existing hosted-member Stripe mutation locks and owner transactions remain
    the serialization boundary; do not add a competing writer.
  - Use only supported Stripe SDK request shapes and preserve PaymentMethod
    versus legacy Source object types.
- Product/process constraints:
  - Preserve onboarding, paid access, Family sponsorship, billing recovery, and
    account-management escape hatches.
  - Keep fixes deletion-first and owner-bound; add persisted state only if a
    production-path proof shows the existing owner cannot represent the needed
    invariant.
  - Treat the supplied patch as implementation input, not verified truth.

## Risks and mitigations

1. Risk: A broad patch can introduce a parallel billing state machine.
   Mitigation: Reduce every change to canonical Stripe reads, existing owner
   locks, one shared collection projection, and existing persisted projections.
2. Risk: A cleanup retry after network ambiguity can cancel or refund the
   accepted subscription.
   Mitigation: Re-read canonical ownership under the existing member/group lock
   and clean up only a completion proven superseded.
3. Risk: Family transfer metadata can reroute webhooks before payment applies.
   Mitigation: Keep authoritative owner metadata unchanged until the canonical
   paid item shape is observed, then switch ownership in the existing
   reconciliation transaction.
4. Risk: Event delivery is duplicated or out of order.
   Mitigation: Treat new events as canonical reconciliation triggers and retain
   existing receipt idempotency and freshness rules.
5. Risk: Adjacent Stripe work in another PR changes the same ownership seam.
   Mitigation: Keep this lane isolated, inspect that PR's exact diff and tests,
   and reconcile its owner-lock contract before final verification.

## Tasks

1. Apply and inspect the supplied draft against current `main`; inventory every
   audit finding, implementation claim, compile error, and omitted integration.
2. Verify the relevant Stripe API and SDK contracts and trace the current Murph
   billing owners, locks, synchronous routes, success callbacks, and webhooks.
3. Implement the smallest owner-bound corrections, deleting or shrinking draft
   machinery that is not needed.
4. Add focused regressions for each repaired state transition and update durable
   current-state billing documentation.
5. Run focused tests while iterating, then canonical `pnpm test:diff ...` and
   full `pnpm verify:acceptance`, plus direct production-shaped billing proof
   available in the repository.
6. Commit and push the candidate, open the PR, run the preliminary
   completion-specialists ReviewGPT pass, resolve accepted findings, perform the
   parent final review, close this plan in the final scoped commit, and run
   final ReviewGPT concurrently with required CI until both pass.

## Decisions

- Use a separate worktree and PR lane because this is cross-cutting,
  billing-sensitive, coverage-bearing code.
- The supplied patch's provider-state approach and new shared module remain
  provisional until canonical code-path and Stripe-contract proof is complete.
- Reuse the existing member and Family owner locks rather than introducing a
  generic billing-attempt table. Standard Checkout adds only the nullable
  reservation fields its existing owner cannot otherwise represent.
- Keep Family invite payment recovery as an explicit two-step client action:
  the form remains in the original tab, Stripe opens from a validated external
  link, and `Finish invite` safely replays the exact owner-locked request. Do not
  persist private invite targets or add a continuation state owner for this
  edge.
- Preserve the merged PR #951 auto-trial serialization owner: subscription
  adoption performs its authoritative Stripe read under the member lock, and a
  no-write loser decision settles bounded cancellation before releasing that
  same lock. Keep this PR's Customer reservation ahead of that boundary rather
  than restoring the superseded release-and-reacquire cleanup path.
- Bound legacy pre-reservation Checkout acceptance to the provider Session
  lifetime plus Stripe's three-day live webhook retry horizon, using the durable
  event receipt time so retries cannot change the decision.
- Require distinct member, Family, and payment-recovery Billing Portal
  configurations in deployed environments and validate their immutable policy
  expectations before use.

## Verification

- Commands to run:
  - focused Vitest suites for every touched owner while iterating
  - `pnpm test:diff ...`
  - `pnpm verify:acceptance`
  - repository-hosted direct billing scenario or Stripe sandbox proof when
    credentials are available
  - preliminary and final ReviewGPT exact-head gates plus required PR CI
- Expected outcomes:
  - every focused and canonical check passes on the exact committed head
  - direct proof demonstrates no premature entitlement and no retained loser
    charge across actionable, failed, expired, duplicate, and reversal paths
  - ReviewGPT returns `ROUND_OUTCOME: PASS` with zero accepted findings

## Evidence to date

- Focused billing, owner, event, cleanup, Family, and settings suites pass,
  including a combined 376-test cross-flow run after the final product fixes.
- Hosted Web prepared typecheck, focused ESLint with zero warnings, privacy and
  unsafe-cast scans, and `git diff --check` pass on the frozen implementation.
- After reconciling the merged PR #951 owner and prepared-crypto seam from
  current `main`, the combined auto-trial suite passes 75 cases and the hosted
  Web prepared typecheck passes.
- Canonical diff verification passes on the reconciled head in isolated
  Testbox `tbx_01kyftvbmepa6c3hrtxen4ns83`, including 7,146 hosted Web tests,
  lint, typecheck, and the production build.
- Full `pnpm verify:acceptance` passes for all 31 workspace projects in isolated
  Testbox `tbx_01kyfv0s35ndtvwamx57yffthj`, including package coverage and both
  hosted Web and Cloudflare application verification.
- An isolated migrated Postgres database proved one-winner checkout reservation,
  duplicate Session rejection, and exact-Session-only attempt clearing.
- Read-only production aggregates found no suspended current billing rows and
  no cross-owner duplicate Stripe customer or subscription bindings requiring
  repair.
- Live Stripe contract tests remain blocked by an expired local Stripe CLI
  login. Deployed build proof remains blocked until the three scoped Portal
  configuration IDs exist in both Stripe modes and Vercel environments.
- Hosted desktop/mobile design proof remains blocked from upload because the
  required local Cloudflare Images credential is unavailable.
Completed: 2026-07-26
