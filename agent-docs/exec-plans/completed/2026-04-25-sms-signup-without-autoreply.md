# SMS Signup Without Autoreply

## Goal

Keep SMS as a supported hosted signup and activation channel while preventing unsolicited non-iMessage inbound texts from receiving automatic invite-link replies.

## Scope

- Hosted onboarding Linq webhook first-contact behavior.
- Hosted onboarding activation route selection for known/verified phone members.
- Focused hosted onboarding tests for non-iMessage inbound suppression and activation welcome routing.

## Constraints

- Do not re-enable automatic invite-link replies for unknown/inactive SMS/RCS inbound first contact.
- Preserve normal signup/activation flows for known SMS-capable members.
- Do not log or fixture production phone numbers, chat ids, member ids, or message text.
- Preserve unrelated dirty ledger and repo work.

## Verification

- Focused hosted onboarding Linq dispatch, home-routing, member-activation, and webhook idempotency tests.
- `pnpm --dir apps/web lint`
- `pnpm typecheck`
- Scoped diff whitespace check.
- Completion audits if the production routing behavior changes materially.

## State

- Done: restored activation participant routing for known/verified SMS-capable members.
- Done: retained the non-iMessage inbound first-contact invite autoreply suppression from the prior commit.
- Done: focused hosted-onboarding tests, apps/web lint, workspace typecheck, scoped whitespace check, and required completion audits passed.
- Now: closing the plan and committing the scoped follow-up.
- Next: hand off the final behavior and verification summary.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
