# Hosted group core permissions

## Goal

Reduce repeated member consent steps by having Murph request a useful reusable
set of group permissions when it first creates a hosted group.

Success criteria:

- New-group setup requests email, steps, broad activity, workout summaries,
  sleep duration, sleep timing, resting heart rate, and HRV by default.
- Every permission remains explicit, individually selectable, and disclosed on
  the existing first-party join or like-to-consent surface.
- An explicit creator choice can still narrow or change the health scopes;
  email remains the existing server-standard request that each member may
  deselect.
- Existing groups continue to use the additive permission opt-in flow without
  making members join again.

## Constraints

- Change prompt policy only; do not widen runtime authority, stored grants, or
  consent semantics.
- Do not request every selectable health projection by default.
- Preserve unrelated working-tree and coordination-ledger edits.
- Keep private identifiers and raw health data out of committed artifacts and
  verification output.

## Approach

1. Add one stable new-group default-scope rule to the hosted-group system prompt.
2. Mirror the detailed decision rule in the group-chat skill and make the
   newsletter and challenge flows defer to the new-group versus existing-group
   status gate.
3. Add focused prompt and skill regression assertions.
4. Run scoped assistant-engine verification and the required prompt-review pass.

## State

Completed.

## Verification

- Assistant prompt, skill-asset, and prompt-size tests: 108 passed.
- Full assistant-engine suite at low concurrency: 2,325 passed, 5 skipped.
- Assistant-engine typecheck: passed.
- Prompt review: first pass found a new-group/existing-group precedence
  ambiguity; the status gate and regression assertions resolved it. The fresh
  pass found only durable-spec wording drift, which was aligned with the active
  consent contract.
Status: completed
Updated: 2026-07-16
Completed: 2026-07-16
