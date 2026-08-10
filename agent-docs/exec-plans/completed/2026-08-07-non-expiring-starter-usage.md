# non-expiring-starter-usage

Status: completed
Created: 2026-08-07
Updated: 2026-08-10

## Goal

- Replace Murph's elapsed-time Pulse trial with one idempotent, non-expiring
  starter-usage grant worth $4.50.
- Make available usage the sole runtime authority for the free experience while
  preserving paid-plan, Family, group, top-up, referral, and recovery behavior.
- Delete Stripe trial provisioning, expiry, continuation, extension, and
  user-facing countdown machinery instead of preserving a second entitlement
  state behind a flag.

## Success criteria

- A new eligible member receives exactly one starter-usage grant and can use it
  until it is consumed, regardless of account age.
- Existing trial members preserve their remaining granted usage and are not
  blocked merely because a historical trial end timestamp passed.
- Signup and instant-start no longer create a Stripe customer or subscription.
- Runtime authorization and usage accounting do not read a trial deadline.
- Starter, paid, sponsored, group, purchased, and referral capacity compose
  through the existing usage-credit and allowance owners.
- Trial-expiry notifications, continuation prompts, extension operations, and
  trial-only UI/API surfaces are removed.
- Stripe remains authoritative for actual paid subscriptions; no parallel
  Murph-owned subscription state machine is introduced.
- Focused tests, schema/migration proof, typecheck, lint, ReviewGPT gates, and
  exact-head CI pass before completion.

## Scope

- In scope: onboarding activation, instant start, direct runtime access,
  allowance resolution, usage status and copy, billing settings/checkout entry,
  Stripe projection compatibility, existing-trial migration, operations pages,
  durable docs, schema, and focused tests.
- Out of scope: pricing changes, paid allowance changes, Family or group pricing,
  new credit products, direct production mutation, or unrelated clinical trial
  content.

## Constraints

- Reuse the immutable usage-credit ledger, beneficiary lock, member activation,
  runtime recheck, and existing paid billing owners.
- Add no timer, scheduler, recovery queue, feature flag, or replacement trial
  state.
- Preserve rolling-deploy and legacy Stripe webhook compatibility explicitly;
  temporary compatibility must be legacy-facing and have a concrete removal
  condition.
- Keep signup idempotent across duplicate requests, retries, invites, Linq
  instant start, and companion activation.

## Risks and mitigations

1. Risk: treating starter access as paid billing could admit incorrect billing
   actions. Mitigation: separate active product access from paid-subscription
   predicates and require a paid phase plus provider identity for billing-only
   actions.
2. Risk: two concurrent signup paths could duplicate $4.50. Mitigation: append
   one semantic-keyed ledger grant under the existing member lock and make
   activation replay-safe.
3. Risk: existing trial spend could be reset or double-granted. Mitigation:
   migrate one canonical full $4.50 grant plus a deterministic debit for prior
   consumption, expose only the unconsumed projection as capacity, and prove
   exact exhausted, partial, untouched, expired, and already-paid cases.
4. Risk: older deployed code or delayed Stripe events could expect trial fields.
   Mitigation: retain only the minimum legacy read compatibility for one rollout
   window, route exact non-paid legacy objects through the canonical Starter
   grant owner, fail closed on potentially paid provider states, and document
   the contract-drop condition.
5. Risk: broad deletion could remove unrelated research uses of “trial.”
   Mitigation: scope changes to hosted billing/onboarding/usage surfaces and use
   path-focused searches plus tests.

## Tasks

1. Trace every hosted trial authority, writer, UI surface, scheduled path, and
   analytics dependency; classify delete, replace, or legacy-read-only.
2. Add one generic starter-usage grant source on the existing credit ledger and
   a replay-safe enrollment/activation service.
3. Replace trial-aware runtime access and allowance resolution with non-expiring
   starter capacity, keeping paid and sponsored ownership explicit.
4. Migrate existing trial members without resetting consumed usage or creating
   duplicate grants; preserve delayed-provider compatibility during rollout.
5. Delete Stripe auto-trial provisioning, expiry/continuation/extension routes,
   jobs, operations UI, copy, and dead tests/docs.
6. Update checkout/settings/onboarding copy and metrics to describe starter
   usage rather than a timed trial.
7. Run focused unit/PostgreSQL/browser proof, static checks, preliminary and
   final ReviewGPT, exact-head CI, and resolve every accepted finding.

## Decisions

- Available usage is the only free-access limit; signup age never denies work.
- Starter usage is represented as an immutable grant, not a synthetic monthly
  plan or an infinite-duration Stripe trial.
- Existing trial database fields may remain for one rolling-deploy compatibility
  window only if old webhooks still require them; runtime entitlement must not
  consult them.
- Historical completed trial plans remain untouched as immutable snapshots.
- A compatibility object is removable only after old trial creators are drained,
  the explicit-mode operator dry-run reports zero candidates, and the delayed
  Stripe event horizon has passed.
- Internal analytics cohort names may remain historical; they do not authorize
  access or create a second product state.

## Verification

- Merged current `main` through `87b871baf44bcf7bd75db743ce670da9f7e5cf7a`.
  GitHub reports PR #1464 mergeable and conflict-free.
- Final ReviewGPT round 7 reviewed the complete sensitive full snapshot at
  `f09a7286365e211e5af56dc6ae60417a0a4fcdde` and returned model-verified
  `PASS` with no qualifying findings. All accepted preliminary and prior-round
  findings were reproduced, corrected, and reverified in their production paths.
- Every exact-head GitHub check completed without failure. The optional live
  hosted-local Stripe browser matrix skipped as configured, and Vercel's ignored
  build step reported success.
- The final merge-focused suite passed 385 tests across eight files, including
  real invoice/subscription receipt retries, usage allowance, billing settings,
  billing-plan compatibility, both migration contracts, and growth metrics.
- Web TypeScript passed after Health Commons and Prisma generation. Scoped lint
  had no errors; conflict-owned production source was warning-free.
- Exact PostgreSQL migration proof covers untouched, partial, exhausted, skipped,
  and atomic-rollback cases. Browser proof covers the exhausted-Starter Settings
  journey on desktop and mobile.
- `git diff --check`, the conflict-marker scan, the privacy-path scan, and the
  final parent diff review passed.

## Rollout checklist

1. Prepare the new Web release, then drain old Web from the affected usage path
   with an atomic traffic cutover or a brief affected-usage maintenance window.
2. While old Web is drained, apply the additive Starter ledger constraint and
   backfill migrations, then direct traffic exclusively to the new Web release.
3. Confirm delayed events convert only exact non-paid legacy objects and that
   `invoice.paid` remains the sole paid authority.
4. Run `stripe:retire-legacy-pulse-trials` in dry-run mode with explicit test/live
   selection; inspect aggregate status counts.
5. Apply with the exact dry-run candidate count. A potentially paid candidate
   aborts preflight before any mutation.
6. Rerun dry-run to zero, then wait through the delayed-event horizon before
   deleting the remaining compatibility fields, wire actions, cleanup owner,
   command, and tests together.
Completed: 2026-08-10
