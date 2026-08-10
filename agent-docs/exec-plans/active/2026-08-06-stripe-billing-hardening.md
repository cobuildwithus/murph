# stripe-billing-hardening

Status: active — final edge-case corrections implemented; exact-head review and CI pending
Created: 2026-08-06
Updated: 2026-08-10

## Goal

- Make Stripe subscription, Family sponsorship, usage-reset, webhook, refund,
  and top-up recovery behavior correct and composable without reintroducing a
  Murph-owned billing state machine.
- Preserve Stripe as payment/subscription authority, Postgres webhooks as the
  local projection owner, and one explicit runtime-recheck path when newly
  purchased capacity can unblock accepted work.

## Success criteria

- A sponsored Family member cannot retain a live direct subscription that may
  later bill independently, including trial subscriptions and invite/webhook
  races.
- A direct or Family allowance increase wakes usage-blocked accepted work after
  the committed billing transition, with replay-safe focused coverage.
- Usage-plan transition capture is two-valued, cannot stamp false transitions,
  and existing invalid same-plan markers are safely cleaned.
- Portal admission proves billable live subscription state before returning
  `already_on_plan` or creating an exact confirmation flow.
- Retryable Stripe event failures remain recoverable without letting permanent
  invariants retry forever.
- Subscription refunds converge from created/updated, partial/cumulative, and
  out-of-order delivery while preserving exact entitlement ownership.
- Settings and return UI describe only genuinely active billing and always
  preserve a clear recovery path.
- Retained legacy-item and top-up-deletion recovery commands close the verified
  low-severity gaps without new queues, managers, or duplicate state owners.
- Focused tests, typecheck, database-backed tests, ReviewGPT gates, and exact-PR
  CI pass.

## Scope

- In scope: direct and Family Stripe billing admission/projection, Customer
  Portal upgrade flow, usage-reset transitions and wakes, Stripe receipt retry
  classification, subscription refund/dispute ownership, Settings billing
  recovery UI, legacy metered-item operator audit, and direct top-up deletion
  recovery.
- Out of scope: pricing changes, new plan types, metered billing restoration,
  new payment providers, broad billing rewrites, or direct production mutation.

## Constraints

- Technical constraints: use existing locks, receipts, webhooks, Stripe Portal,
  runtime recheck, and ledger owners; add no new durable state owner unless a
  demonstrated invariant cannot be expressed through the existing owner.
- Product/process constraints: preserve every product-critical paid, trial,
  Family, top-up, refund, and recovery flow; use the isolated worktree/PR lane;
  preserve unrelated edits; follow the preliminary and final ReviewGPT gates.

## Risks and mitigations

1. Risk: tightening Family admission could strand legitimate trial members.
   Mitigation: define one provider-backed direct-subscription invariant and a
   recoverable, explicit transition rather than silently deleting access.
2. Risk: broader webhook retries could loop permanent failures.
   Mitigation: classify retryability from concrete error/provider evidence and
   retain poison for proven permanent invariants with alertable state.
3. Risk: stale refund events could suspend the wrong current subscription.
   Mitigation: require live same-customer/subscription/latest-invoice proof and
   serialize the negative transition under the existing billing owner.
4. Risk: frontend fixes drift from production behavior.
   Mitigation: render the real shared components in the design catalog and
   prove active, lapsed, sponsored, and exhausted-poll recovery states.

## Tasks

1. Obtain ReviewGPT's scoped attachment patch against this exact branch.
2. Inspect the patch as behavioral intent and simplify it around existing
   ownership boundaries before applying. Completed: the retained ReviewGPT
   artifact was path-scoped, passed `git apply --check`, was applied as an
   untrusted candidate, and was adapted only where focused proof exposed stale
   assumptions or incomplete coverage.
3. Implement and test Family direct-subscription exclusion and sponsored UI.
   Completed with unit, PostgreSQL, and rendered catalog proof.
4. Implement post-commit usage-capacity wakes for direct and Family upgrades.
   Completed with replay-safe focused coverage.
5. Correct and clean the nullable transition bridge. Completed with a fresh
   database migration deploy and PostgreSQL regression proof.
6. Harden Portal admission, Stripe retry recovery, and refund convergence.
   Completed with focused event, policy, reconciliation, and status suites.
7. Close retained operator/top-up recovery gaps and truthful Settings recovery.
   Completed with focused legacy migration, account deletion, saved-card, and
   Settings suites.
8. Run focused proof, typecheck, design evidence, exact-head ReviewGPT gates,
   and CI; resolve every accepted finding before plan closure. Local proof and
   prior design evidence are complete; the final rendered proof, exact-head
   gate, and CI remain pending.

## Decisions

- Prefer deletion and narrow extensions of current owners over a new billing
  orchestration layer.
- Keep the Family-owner exception at the event classifier, where the exact
  Stripe subscription and Family group identity are both available. The
  general Family-claim read remains fail-closed.
- Keep only explicit retry authority: concrete transient provider/database
  errors and the typed committed runtime-recheck obligation may pass the poison
  cap; post-commit placement alone is not retry evidence.
- Treat the current sponsored personal-trial row as an operational follow-up;
  this code task will not mutate production Stripe state.
- Serialize every Family-caused direct-subscription cleanup through the
  existing Family owner lock before the sponsored member lock. Preserve a
  conflicting Checkout attempt until that guarded cleanup commits so a Family
  authority change can retry the receipt and bind direct billing instead.
- Treat the local paid Family binding as a projection, not cancellation or
  refund authority. Immediately before an irreversible direct-subscription
  cleanup, require Stripe to return the exact active Family subscription,
  customer, plan metadata, group, and owner. A missing, terminal, unpaid, or
  mismatched provider object preserves the direct subscription for receipt
  replay; no new queue or billing state machine is needed.
- Revalidate an auto-seat invite target inside the existing Family owner lock,
  immediately before the Stripe capacity mutation, so a concurrently accepted
  membership cannot be charged as an extra seat and then rejected.
- Let the first Family-authoritative event own complete direct-checkout loser
  cleanup. It must cancel and prove an exact refund or zero payment before it
  terminalizes the receipt; a later invoice cannot be the only refund owner.
- Expose the same paid-trial conversion terms and explicit-confirmation token
  through the private Family tool as the website path, so Assistant-driven
  checkout cannot bypass or dead-end the confirmation invariant.

## Verification

- Focused Vitest proof after parent remediation: 246 core billing/event tests,
  114 Settings tests, and 371 store/service/migration tests pass.
- PostgreSQL proof: all 165 migrations, including the transition-bridge repair,
  deploy into the isolated worktree database; the new migration proof and
  Stripe webhook entitlement suite pass 5/5 with serial Postgres execution.
- Static proof: `pnpm --dir apps/web typecheck`, `pnpm --dir apps/web lint`
  (zero errors; 38 unchanged warnings), `pnpm test:frontend-design-proof`, and
  `git diff --check` pass.
- Rendered proof: the real catalog components were inspected at 2368×1222
  desktop and 700×1712 mobile native resolutions for pending-upgrade and
  Family-sponsored states; both uploaded evidence URLs pass the delivery
  check. The sponsored state has no self-service or disabled pseudo-action.
- Production migration guard proof passes on the rebased candidate, where the
  nullable provenance constraint already uses its dedicated postdeploy
  migration instead of a predeploy exception.
- ReviewGPT round 4 exposed a review-induced Family cleanup race. Its owner-first
  correction passes 473 focused Stripe/Family unit tests, 9/9 PostgreSQL webhook
  and lock-order tests on a fresh 165-migration database, Web typecheck, focused
  ESLint, and diff checks. Production aggregate proof confirms every current
  non-owner Family sponsorship has the paid active Family identity required by
  the guard.
- ReviewGPT round 5 found that the local Family projection could lag a terminal
  provider transition. ReviewGPT's claimed attachment was absent from the
  thread, so it returned the complete 397-line unified diff inline; the diff
  passed `git apply --check` against the reviewed head before application. The
  provider-authority correction plus expanded mismatch controls pass 732
  changed-surface tests, Web typecheck, focused ESLint, diff checks, a fresh
  165-migration deploy, and 10/10 serial PostgreSQL webhook/lock-order tests.
- The preliminary specialist gate passed on the first candidate. Remaining:
  push the provider-authoritative candidate, run the next exact-head final
  ReviewGPT round concurrently with GitHub Actions, resolve any accepted
  findings, and close this plan with final exact-head evidence.
- The final candidate is merged with current `main`. The one semantic conflict
  preserves `main`'s newer all-active-Family-member lock while retaining exact
  Stripe-event replay wake derivation. After Prisma regeneration, Web typecheck,
  focused ESLint, 732 changed-surface tests, a fresh 166-migration deploy, and
  10/10 PostgreSQL webhook/lock-order tests pass. The new SDK-typed Stripe
  request guard also passes; its merge-exposed subscription-resume probe now
  starts without unsupported top-level `await`, with focused contract coverage.
- ReviewGPT round 7 found that the terminal-subscription correction from round
  6 ran before the existing Checkout acceptance owner. The narrow correction
  removes that shortcut and lets the locked acceptance owner distinguish an
  accepted replay from an unaccepted terminal attempt. An accepted replay is a
  no-op with no refund or welcome; a pending terminal attempt remains
  receipt-owned cleanup. Web typecheck, full lint, the Stripe request guard, 748
  changed-surface tests, a fresh 166-migration deploy, and 12/12 serial
  PostgreSQL receipt/lock-order tests pass. The formal loop is paused at its
  seven-round cap pending the policy-required explicit round-eight decision.
- ReviewGPT's first inline remediation diff lost every hunk prefix and failed
  `git apply --check`. The explicit artifact retry returned a valid five-file
  patch whose reported SHA-256 matched locally and whose whitespace-strict
  apply check passed against the exact reviewed head. Its ownership ordering,
  cross-member identity fence, and legacy regression were incorporated; the
  optional boolean and third success variant were simplified into the required
  two-state disposition on the existing acceptance owner.
- The final sweep adds fail-first regressions for the auto-seat target race,
  first-event refund ownership, and private-tool trial confirmation. The
  corrected candidate passes 441 focused Web tests, 92 Assistant tests, 64
  hosted-execution parser tests, all three package typechecks, both hosted
  billing/provider request guards, and 12/12 real-PostgreSQL Family cleanup and
  webhook tests against a freshly migrated isolated database.
