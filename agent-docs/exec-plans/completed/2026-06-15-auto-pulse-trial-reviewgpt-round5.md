# Auto Pulse Trial ReviewGPT Round 5

## Goal

Close the remaining PR #173 ReviewGPT findings from the round 5 review.

Success criteria:
- auto-trial Stripe recovery lookup paginates customer subscriptions
- broad same-member Pulse Trial live matches prevent duplicates, but only current policy/current price trialing subscriptions are reused
- stale invite pages that hit `HOSTED_MESSAGING_CHANNEL_REQUIRED` refresh into setup instead of support escalation
- focused tests, `apps/web` typecheck, `apps/web verify`, and ReviewGPT pass

## Scope

- auto Pulse Trial subscription recovery lookup
- auto-trial island error handling
- matching tests

## Constraints

- Do not bind older or mismatched trial subscriptions as the current entitlement.
- Do not create another subscription when any live same-member Pulse Trial exists.
- Keep support fallback for true Stripe recovery-required states.

## Plan

1. Page through Stripe customer subscriptions in recovery lookup.
2. Split broad live-match detection from strict reusable-subscription validation.
3. Refresh stale messaging-required auto-trial errors into the existing setup flow.
4. Re-run validation and ReviewGPT.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
