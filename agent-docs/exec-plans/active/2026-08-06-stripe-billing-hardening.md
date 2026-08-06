# stripe-billing-hardening

Status: active — candidate implemented and locally verified; exact-head review gates pending
Created: 2026-08-06
Updated: 2026-08-06

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
   design evidence are complete; exact-head gates and CI remain pending.

## Decisions

- Prefer deletion and narrow extensions of current owners over a new billing
  orchestration layer.
- Treat the current sponsored personal-trial row as an operational follow-up;
  this code task will not mutate production Stripe state.

## Verification

- Focused Vitest proof: 241 core billing/event tests, 113 Settings tests, 326
  store/service tests, and the individually rerun Family, usage, reconciliation,
  checkout, policy, status, and billing-event owners all pass.
- PostgreSQL proof: all 165 migrations, including the transition-bridge repair,
  deploy into the isolated worktree database; the new migration proof and
  Stripe webhook entitlement suite pass 5/5 with serial Postgres execution.
- Static proof: `pnpm --dir apps/web typecheck`, `pnpm --dir apps/web lint`
  (zero errors; 38 unchanged warnings), `pnpm test:frontend-design-proof`, and
  `git diff --check` pass.
- Rendered proof: the real catalog components were inspected at desktop and
  mobile native resolutions for pending-upgrade and Family-sponsored states;
  both uploaded evidence URLs return HTTP 200 PNG responses. A fresh Claude
  Fable review returned PASS for pending recovery context, sponsored ownership,
  and lapsed-plan truthfulness.
- Unrelated blocker: `production-migration-guard.test.ts` currently fails two
  assertions because the pre-existing committed
  `20260806170000_hosted_pulse_trial_start_source` migration contains
  `ADD CONSTRAINT CHECK` without the guard's frozen exemption. This candidate
  neither changes that migration nor introduces the flagged pattern.
- Remaining: push the candidate, run exact-head preliminary specialists and
  final ReviewGPT round 1 concurrently with GitHub Actions, resolve any accepted
  findings, then close this plan with final exact-head evidence.
