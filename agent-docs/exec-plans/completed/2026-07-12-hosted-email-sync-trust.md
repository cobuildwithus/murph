# Hosted email sync trust

## Goal

Make Settings report an email-linking success only after Murph has persisted the
canonical Privy-verified address for the authenticated member, while tracing the
affected Stripe billing-contact lineage without exposing customer data.

Success criteria:

- A phone-only Privy link callback cannot fall back to a stale initial or Stripe
  hint address and display a false terminal success.
- The client performs the canonical `/api/settings/email/sync` step after a
  successful Privy link and uses only the server result as success evidence.
- Missing or temporarily stale Privy address data remains actionable instead of
  being presented as linked.
- Provider identity mutation UI mounts only when the current Privy client user
  matches the first-party Murph app session.
- Phone or Telegram authentication does not silently promote a secondary Privy
  email credential into canonical Murph email authorization.
- Focused regression coverage proves the observed first-attempt failure shape
  and the normal update flow.
- Stripe investigation identifies the object/event lineage with privacy-safe,
  read-only evidence; it does not mutate production or persist provider data.

## Constraints

- Preserve fresh Privy proof and the existing Murph app-session authority gate.
- Do not promote Stripe billing-contact hints into verified identity.
- Do not add a retry queue, new persisted state, or another identity owner.
- Keep raw emails, phone numbers, Stripe identifiers, auth identifiers, tokens,
  and local paths out of committed artifacts and user-facing diagnostics.
- Preserve unrelated working-tree and coordination-ledger edits.

## Approach

1. Reproduce the stale-link callback path in the focused Settings controller
   tests.
2. Collapse terminal success onto the existing server sync response and keep
   unresolved Privy state non-terminal and retryable.
3. Restore the pre-provider app-session/Privy-principal equality gate and stop
   automatic secondary-email promotion after non-email authentication.
4. Update the narrow product and trust contracts if the canonical success rule is not
   already durable.
5. Run focused tests, truthful diff coverage/typecheck, direct scenario proof,
   and the required security/privacy, frontend, and coverage audits.
6. Commit the scoped change through `scripts/finish-task`, then open and review a
   PR on the isolated task branch.

## Verification

- Focused hosted email Settings controller tests.
- `pnpm test:diff` for the touched web owner and product contract.
- Browser proof for phone-only link success, stale callback behavior, and
  canonical address rendering when a production-faithful local flow is
  available.
- Privacy-safe Stripe CLI object/event timeline; no provider writes.

## State

Complete.

## Investigation notes

- The required Fable-first sweep found no available signed-in Claude profile;
  the parent agent therefore implemented directly in the isolated worktree.
- Read-only live Stripe lineage inspection disproved the billing-hint theory for
  the address shown during the incident. The renewal refreshed an unchanged,
  different Checkout-collected billing address; the incident address appeared
  in no live Stripe customer, Checkout Session, or invoice inspected.
- The first Settings attempt had no canonical email-sync request. The old
  client path could nevertheless report terminal success and reuse the initial
  unverified display value. A focused regression reproduced that exact
  callback shape before the fix.
- A later successful canonical sync proves the then-current fresh Privy user
  exposed a verified email for the same Murph member. Existing Murph state is a
  mutable snapshot and does not retain provider credential-link history, so it
  cannot by itself establish when that provider association was first created.
- Static writer and git-history review found two concrete recurrence paths: a
  removed app-session/Privy-principal equality gate allowed provider mutation
  before the later server mismatch check, and non-email authentication
  automatically promoted any verified secondary Privy email to canonical
  member authorization. The exact historical trigger remains unavailable
  without provider credential-link history, but both reachable paths are now
  closed by the narrow owner-boundary changes in this plan.
- Focused final verification passed 102 Settings, session-gate, authentication,
  and snapshot tests. The final standalone web typecheck, diff check, prepared
  local dev smoke, and a serial rerun of 112 unrelated timeout-only tests also
  passed. A full diff-aware run passed 375 test files and 4,261 tests before four
  unrelated files hit exact 60-second timeouts while several other worktrees
  were verifying concurrently; all four passed in the serial rerun. That same
  aggregate run compiled the production bundle, completed TypeScript, and
  reported zero lint errors before it was stopped during static generation
  because its already-recorded timeout failures made the final exit non-green.
- The required security/privacy audit found no medium-or-higher finding. The
  frontend audit found three recovery-state issues; all were fixed and the
  final rerun found no remaining issue. Coverage-write found the stable-boundary
  proof complete and made no changes.
Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
