# Auto Pulse Trial ReviewGPT Round 4

## Goal

Close the remaining PR #173 ReviewGPT findings from the round 4 review.

Success criteria:
- canceled or otherwise terminal Stripe cleanup artifacts do not block a fresh auto-trial retry
- `customer.subscription.resumed` for an active recovered Pulse Trial cannot leave local state incomplete or active with an expired trial phase
- unrelated audit-routing docs are not bundled into the billing/onboarding PR branch
- focused hosted-onboarding tests, `apps/web` typecheck, `apps/web verify`, and ReviewGPT pass

## Scope

- auto Pulse Trial recovery lookup
- Stripe subscription resumed phase/status handling
- PR branch diff scope
- matching tests

## Constraints

- Do not use `active + expired trial` as the resumed state.
- Keep invoice proof as the normal conversion path for ordinary subscription updates.
- Preserve user-requested docs work outside this billing PR.

## Plan

1. Ignore terminal recovered subscriptions in auto-trial retry lookup.
2. Make resumed active subscriptions resolve to a paid billing phase/status explicitly.
3. Remove audit-routing docs from this billing PR branch.
4. Re-run validation and ReviewGPT.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
