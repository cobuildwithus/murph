# Hosted billing edge-case sweep

Status: active
Updated: 2026-08-10

## Goal

Find and correct remaining hosted billing paths that can strand a person in a
false conflict, conceal a recoverable payment, duplicate an irreversible
provider action, or leave Murph and Stripe with contradictory ownership.

Success means:

- every confirmed defect has a production-faithful failing regression before
  its correction;
- personal, Family, group sponsorship, usage-credit, Checkout, Portal,
  subscription, cancellation, and webhook recovery paths preserve one clear
  owner and a usable off-ramp;
- browser and public identifiers never create payment authority;
- Stripe payment facts and Murph entitlement facts converge through their
  existing reconciliation owners; and
- focused proof, Web typecheck/lint, billing guards, exact-head CI, preliminary
  specialist review, and final ReviewGPT pass before merge.

## Scope

- In scope: hosted Web billing admission, projections, mutations, provider
  calls, receipts, retries, cancellation, recovery, and their direct tests.
- Out of scope: pricing changes, new plan types, new payment providers, direct
  production mutation, and speculative billing infrastructure.

## Invariants

- A conflict message describes the submitted target, not stale UI state or an
  unrelated member.
- Mutable authority is revalidated at the owning lock immediately before an
  irreversible effect or release of payable capability.
- Ambiguous provider outcomes retain one stable attempt and recovery path;
  they never mint a replacement charge or silently terminalize.
- Cancellation remains available to the authenticated payer even after target
  authority changes.
- Browser return state never grants entitlement or usage credit.
- Webhook replay and reordering converge monotonically on the provider-verified
  current billing owner.
- Tests, audit notes, commits, and PR text use synthetic identifiers only.

## Implementation

1. Inventory each hosted billing entry point, state owner, Stripe mutation,
   webhook event, browser projection, and recovery/cancellation route.
2. Trace guard symmetry, ordering, idempotency, stale-state handling, and
   external-provider failure boundaries across personal, Family, and group
   targets.
3. Record hypotheses privately, verify each medium-or-higher candidate through
   the complete call path, and add a failing regression for every accepted bug.
4. Implement only the smallest owner-local corrections proved necessary,
   deleting or reordering existing logic before adding abstractions or state.
5. Run focused suites, Web typecheck/lint, provider request and hosted billing
   guards, then exact-head CI and the required ReviewGPT lanes.
6. Merge only after all accepted findings and required checks are green; verify
   the applicable main-only hosted Stripe workflow and retire the worktree.

## Verification

- Focused Vitest suites for every changed billing owner and regression.
- `pnpm --dir apps/web typecheck` and scoped/full Web lint as routed.
- `pnpm provider-requests:guard` and `pnpm hosted-billing:ci-guard`.
- The credential-free hosted billing owner proof from the verification map.
- Direct synthetic journey checks for each corrected recovery or conflict
  path; no production mutation.
- Preliminary product-experience and coverage ReviewGPT lenses, final
  sensitive ReviewGPT gate, exact-head PR CI, clean merge proof, and the
  main-only live hosted Stripe matrix when applicable.

## Progress

- [x] Inventory billing actions, state owners, inverse operations, provider
  effects, browser recovery, and webhook reconciliation.
- [x] Verify and correct sixteen independent traps across Family, direct-plan,
  usage-credit, Portal, refund, and sponsorship paths.
- [x] Add focused regressions plus an installed real-PostgreSQL migration and
  account-deletion proof.
- [x] Pass the affected suites, TypeScript, explicit provider-request guard,
  hosted billing CI guard, and credential-free Stripe owner proof.
- [x] Capture desktop/mobile design-catalog evidence for Family billing repair
  and sponsorship cancellation. The separate Claude UI check could not run
  because the required local `claude` command is not installed; the tooling gap
  is recorded rather than treated as a product failure.
- [x] Push the exact candidate and open the PR. The first preliminary review
  rejected incomplete rendered evidence rather than the implementation: the
  catalog had made the cancel-only proof inert and had not exercised Portal
  failure or the signed-out usage-return handoff.
- [ ] Push the evidence remediation, rerun preliminary and final ReviewGPT with
  exact-head CI, resolve findings, close this plan, and merge.
- [ ] Confirm the main-only live Stripe browser matrix and cleanup result on the
  merged commit, then retire the task worktree.

## Verified findings

The Feynman audit artifacts under `.audit/findings/` contain the complete
function-state matrix and verification ledger. The accepted defects are:

1. Direct-paid Family owners were rejected during valid member retiering.
2. Nonterminal inactive Family billing had no Portal recovery action.
3. Suspended direct members could not open Portal to repair or cancel billing.
4. Renewal scheduling admitted cancel-at, paused, manual-collection, and
   already-scheduled Stripe subscriptions.
5. Deterministic pre-provider Family tier failures stranded a pending marker.
6. Invite retiering could be mistaken for authorization to purchase a new seat.
7. Inviting the current owner/member by contact could buy an unusable seat.
8. Direct Trial to Family conversion could create a competing Subscription.
9. Start-paid update/resume could use pre-lock billing or suspension authority.
10. A terminal unbound automatic-refill failure blocked payer account deletion.
11. Signed-out usage-credit Stripe returns lost their recovery destination.
12. Portal errors rendered outside the dialog that made them visible.
13. A payer could lose sponsorship cancellation after beneficiary access loss.
14. A bound automatic refill could confirm after the payer was suspended.
15. Legacy Family refund cleanup guessed one payment and ignored partial refund.
16. A late paid direct invoice after Family activation was canceled without the
    exact ordinary refund attempt.

## Current evidence

- Affected hosted-web tests: 767 passed, 23 opt-in tests skipped.
- Installed local PostgreSQL migration/concurrency proof: 23 passed.
- Credential-free Stripe owner proof: 87 harness tests and 73 web tests passed.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm provider-requests:guard`: passed after replacing all new Stripe request
  spreads with explicit SDK-typed parameter construction.
- `pnpm hosted-billing:ci-guard`: passed.
- Parent hardening review added proof that an already-applied direct-to-Family
  retry normalizes metadata without rebuilding the obsolete direct item swap,
  and that Linq/Telegram treat the same-group acceptance backstop as a
  permanent invite miss instead of retrying it indefinitely.
- Design catalog evidence (desktop and mobile) was captured and inspected for
  Family management, enabled sponsorship cancellation, cancellation failure,
  Portal failure inside its confirmation dialog, and the signed-out
  usage-credit return screen. Focused remediation tests pass (18 tests), as do
  the Web TypeScript check, scoped lint, and frontend-design-proof unit suite.
  The required Claude UI double-check was unavailable because the local CLI is
  not installed.
- The first exact-head CI run passed the hermetic billing, Stripe boundary,
  build/typecheck, package-coverage, artifact, overflow, and deployment lanes.
  Its release-app failure was an inventory assertion for the new canonical
  migration; the inventory now includes that migration and the focused
  migration suite passes.
