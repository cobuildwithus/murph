# PR 972 Final Review Remediation

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Reproduce and resolve the four substantive final ReviewGPT findings on PR
  #972 without adding a billing owner, weakening account controls, or losing
  the initiating Family invite action across ordinary browser lifecycle events.

## Scope

- Current-entitlement funding attribution after full Stripe refunds.
- Family invite payment-recovery continuation across a Settings page reload.
- Account-deletion handling for Stripe Customers introduced or discovered by
  the new reservation recovery path.
- Family member upgrade confirmation copy for immediate proration collection.
- Focused regressions, canonical verification, PR intent/evidence updates, and
  correction-only ReviewGPT round 2.

## Constraints

- Stripe remains canonical and the existing member and Family locks remain the
  only mutation owners.
- Do not add a local invoice ledger, pending-invite table, queue, cron, or
  second reconciliation state machine.
- Preserve successful account deletion for ordinary billed members while
  preventing newly recovered or unowned Stripe Customers from being orphaned.
- Keep private invite targets out of URLs and bind any short-lived continuation
  to the authenticated owner and Family group.

## Tasks

1. Prove or reject each reported failure against the production call path and
   add a focused failing regression for every accepted finding.
2. Implement the smallest owner-bound correction and update the design catalog
   or durable product contract only when behavior changes require it.
3. Run focused tests and typecheck, then canonical diff verification and full
   acceptance for production changes.
4. Close this plan in the final scoped commit, push the remediation head, update
   the PR body and immutable-baseline/current-head evidence, and run final
   ReviewGPT round 2 concurrently with CI.

## Evidence

- Final ReviewGPT round 1 completed on
  `bce9f6e4b74644485056f1bee4d1071813bafe85` with trusted
  `gpt-5-6-pro` model evidence and reported four findings.
- Fully refunded `subscription_update` invoices now revoke only the current
  Stripe-backed entitlement established by their positive proration lines;
  partial refunds remain funded and a later canonical update supersedes an
  earlier refunded update.
- Payment-required Family invites now carry an encrypted, authenticated,
  owner- and group-bound 30-minute continuation in an HttpOnly cookie. A real
  route integration covers payment required, cookie recovery, successful
  retry, and cookie clearing.
- Account-deletion preflight is limited to replayed Pulse Trial reservation
  Customers, before destructive effects. Existing billed Customers retain the
  established post-local-delete best-effort cleanup policy.
- Family member upgrades now say Stripe charges the prorated difference
  immediately, while downgrade-credit copy remains next-invoice-specific. The
  shared production confirmation content is represented by a design-catalog
  state.
- Product-experience review returned `NO FINDINGS`.
- Focused route, page, component, account-deletion, billing-lookup, layout, and
  continuation tests passed; Web prepared typecheck, scoped ESLint, and
  `git diff --check` passed.
- Canonical diff verification passed in Testbox
  `tbx_01kyg1f898f5d1k2b3ncgxm6fj` with 535 test files passed and 7,143 tests
  passed.
- Full acceptance passed in Testbox
  `tbx_01kyg1ke3dy9ec7f8fjntftr43`, including workspace typecheck, coverage,
  app verification, 106 Cloudflare Node test files with 1,928 tests, and two
  Cloudflare Workers tests.
- Fresh rendered proof could not be captured because no in-app browser backend
  was attached. The Frontend Design Proof gate remains externally blocked
  until the scoped Cloudflare Images credentials are available locally for
  hosted screenshot URLs.
Completed: 2026-07-26
Completed: 2026-07-26
