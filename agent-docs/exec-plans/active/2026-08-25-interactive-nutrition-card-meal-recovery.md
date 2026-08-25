# Interactive Nutrition Card Meal Recovery

Status: active
Created: 2026-08-25
Updated: 2026-08-25

## Goal

Restore the existing nutrition-card promise when a requested card is blocked by
one recent unresolved device-captured meal. Route the ordinary interactive card
turn through the existing automatic-meal-capture recovery owner, then use fresh
canonical totals for the card.

## Product UX Patch

- Outcome: A member asking for today's nutrition card can recover a recent
  device meal instead of receiving a blank-totals dead end.
- Reaches: Private iMessage nutrition-card requests with a recent unresolved
  automatic capture, including a privacy-tombstoned photo when conversation and
  saved facts still identify the meal.
- Proof: A production-prompt live Terra turn re-identifies and edits the existing
  synthetic device meal, reads it back, refreshes totals, and attaches the card
  without adding a duplicate meal.

## Tasks

1. Put one direct handoff in the existing system skill router so requested
   nutrition cards load `automatic-meal-capture` with `food-journal` before
   treating missing totals as terminal.
2. Add deterministic prompt-contract assertions for the handoff and its
   no-duplicate/fresh-totals boundary.
3. Add one opt-in real-model interactive card fixture using the production
   system prompt, synthetic canonical Goal and meal state, and the real response
   card tool.
4. Run focused tests, package typecheck, provider-input measurement, and the
   opted-in live `gpt-5.6-terra` scenario.
5. Complete the prompt-primary PR specialist review, exact-head CI, merge, and
   hosted-runner deployment proof.

## Constraints

- Reuse the existing automatic-meal-capture recovery owner; do not duplicate its
  meal-repair policy in the system prompt or response-card tool.
- Add no service, queue, state, schema, migration, retry manager, or new runtime
  owner.
- Never add a replacement meal, restore removed photos, invent nutrients, or
  reuse totals read before a successful meal edit and readback.
- Keep fixtures synthetic and omit private feedback, screenshots, transcripts,
  production rows, and direct identifiers.

## Verification

- Focused system-prompt and automatic-meal-capture prompt-contract tests.
- Interactive synthetic App Server scenario proving existing-meal edit,
  readback, fresh totals, card attachment, and zero duplicate adds.
- Assistant-engine typecheck, provider-input measurement, and `git diff --check`.
- Opted-in live `gpt-5.6-terra` execution of the exact interactive fixture.
- Preliminary Product UX, prompt, and coverage ReviewGPT pass; required exact-head
  CI; current-base merge proof; hosted runner fingerprint and live smoke after
  deployment.
