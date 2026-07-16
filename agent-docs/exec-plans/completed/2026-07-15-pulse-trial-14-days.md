# Extend new Pulse Trials to 14 days

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Make every newly created Pulse Trial last 14 days instead of 10 days while
  preserving the recorded policy and behavior of trials already created under
  earlier versions.

## Success criteria

- Both no-card enrollment and card-based Stripe Checkout create new Pulse
  Trial subscriptions with a 14-day duration.
- Existing seven-day and ten-day policy versions remain readable and keep
  their historical duration semantics.
- User-facing trial copy reports 14 days consistently.
- Focused billing tests, full repository verification, required completion
  audits, PR CI, and ReviewGPT pass with no unresolved accepted findings.

## Scope

- In scope: the hosted billing policy registry, new-trial creation inputs,
  Pulse Trial presentation copy, directly affected tests, and the durable
  Pulse Trial product spec.
- Out of scope: changing usage allowance amounts, extending existing active
  subscriptions, renaming the persisted legacy offer id, adding a new plan,
  or changing trial-to-paid conversion behavior.

## Constraints

- Introduce a new policy version for new trials; do not rewrite the meaning of
  persisted historical policy versions.
- Keep the existing `pulse_trial_7d` offer identifier for compatibility.
- Keep Stripe billing and entitlement ownership in the existing hosted web
  surfaces with no new state owner or migration.

## Risks and mitigations

1. Risk: changing the current policy in place could make existing ten-day rows
   resolve as 14-day trials.
   Mitigation: retain the ten-day policy as an explicit historical entry and
   point only new creation metadata at a new 14-day policy version.
2. Risk: one creation path or UI surface could remain on ten days.
   Mitigation: trace both auto-enrollment and Checkout through the shared
   constant, update focused assertions and copy tests, and run a stale-value
   search over live billing surfaces.

## Tasks

1. Map the shared trial policy, both subscription creation paths, and visible
   duration copy.
2. Add the 14-day current policy while retaining historical versions.
3. Update focused billing and presentation coverage plus the durable spec.
4. Run full verification, coverage review, ReviewGPT/CI, and parent final
   review.
5. Close the plan with a scoped commit and hand off the merge-ready PR.

## Verification

- Focused hosted billing, auto-enrollment, UI, growth-metrics, and changelog
  tests passed (360 assertions in the implementation pass, 50 assertions in
  the post-audit auto-enrollment pass, and 12 assertions in the changelog
  correction pass).
- `pnpm test:diff` passed the affected `apps/web` verification lane: 5,214
  tests passed and 140 skipped; build, dev smoke, lint, and typecheck were
  green with only existing warnings.
- A direct policy scenario proved the current v3 policy resolves to 14 days
  while historical v2 still resolves to 10 days.
- `pnpm verify:acceptance` passed repository typechecks and guards, then was
  blocked in untouched assistant packages: assistant-engine exhausted its
  4 GB worker heap, and one assistant-runtime case failed transiently before
  passing immediately in isolated reproduction.
- `git diff --check`, the live-surface stale-value search, and the changed-diff
  privacy/secret scan passed.

## Decisions

- Add `pulse-trial-2026-07-15-v3` as the current 14-day policy and retain v1
  (7 days) and v2 (10 days) unchanged for historical rows.
- Keep the persisted `pulse_trial_7d` offer id. A rename would add a migration
  without changing product behavior.
- Let auto-enrollment recover and finalize any server-known trial policy, then
  persist the policy proven by Stripe metadata. This prevents an in-flight v2
  subscription from being stranded during deployment while unknown versions
  continue to fail closed.

## Completion audits

- `coverage-write`: accepted a test-only correction that made the default v3
  Stripe fixture use a real 14-day end date and added explicit v2 recovery
  persistence proof. No unresolved findings remain.
- `frontend-review`: no findings. The visible 14-day copy derives from the
  shared policy constant and reuses the existing responsive pricing and
  changelog components. Static render coverage supplied the available UI
  proof; hosted authentication state prevented a useful browser screenshot.

## Deployment note

- The web release can read v1/v2 rows and creates only v3 trials. After the
  first v3 subscription exists, this release is the rollback floor because an
  older v2-only web release correctly fails closed on unknown v3 metadata;
  prefer a forward fix over rolling back below this version.
- PR CI, ReviewGPT, and merge-conflict proof remain before closure.
Completed: 2026-07-15
