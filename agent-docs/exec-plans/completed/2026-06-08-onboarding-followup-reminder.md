# Onboarding follow-up reminder

## Goal

Seed a hosted assistant automation after the signup welcome succeeds so users
who have not completed Murph onboarding get a gentle daily follow-up at local
lunchtime.

Success criteria:

- Reuse canonical `bank/automations` and assistant cron runtime state.
- Do not add a new scheduler, database table, hosted-execution wake kind, or
  Temporal workflow behavior.
- First reminder is no earlier than the next local-day lunch after seeding.
- Reminder can self-disable once onboarding is complete or declined.
- Route mapping stays explicit and valid for Linq and Telegram.

## Constraints

- Preserve hosted ownership boundaries: web owns product facts, Temporal owns
  pointer-only orchestration, Cloudflare owns execution, Murph runtime owns
  assistant automation semantics.
- Keep automatic outbound user messages on the normal AI-gated assistant path.
- Keep logs and tests free of secrets, raw payloads, direct user identifiers,
  local account names, and home-directory paths.
- Prefer the smallest helper surface that expresses the existing
  `addAssistantCronJob` write pattern idempotently.

## Approach

1. Add an assistant-engine helper that idempotently upserts a canonical
   automation plus optional first canonical cron occurrence state.
2. Add a hosted-runtime onboarding reminder seeding helper that detects signup
   welcome notifications, maps the welcome route to a canonical automation
   route, computes next local lunch, and calls the assistant-engine helper.
3. Add a minimal automation status command for self-disable without
   reconstructing the full automation.
4. Permit notification decisions to run only the explicit automation archival
   command when private scheduled-check instructions require self-disable.
5. Cover idempotency, first occurrence, route mapping, welcome-only seeding, and
   failure isolation with focused tests.
6. Run required scoped verification, completion audits, and commit with
   `scripts/finish-task`.

## State

Active.

## Notes

- Current preferred seed path is after successful `assistant.notification.requested`
  signup welcome handling in hosted runtime.
- The first same-day edge case should be handled through existing canonical
  cron `pendingOccurrenceAt` runtime state, not a new schema field.
Status: completed
Updated: 2026-06-08
Completed: 2026-06-08
