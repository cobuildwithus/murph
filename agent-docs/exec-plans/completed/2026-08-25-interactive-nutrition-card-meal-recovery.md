# Interactive Nutrition Card Meal Recovery

Status: completed
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

1. [x] Put one direct handoff in the existing system skill router so requested
   nutrition cards load `automatic-meal-capture` with `food-journal` before
   treating missing totals as terminal.
2. [x] Add deterministic prompt-contract assertions for the handoff and its
   no-duplicate/fresh-totals boundary.
3. [x] Add one opt-in real-model interactive card fixture using the production
   system prompt, synthetic canonical Goal and meal state, and the real response
   card tool.
4. [x] Run focused tests, package typecheck, provider-input measurement, and the
   opted-in live `gpt-5.6-terra` scenario.
5. [x] Complete the prompt-primary specialist review and exact behavior-head
   proof. Merge and hosted deployment remain the authorized operational
   completion steps after final exact-head CI.

## Outcome

- Replaced the prior ambiguous eligibility wording with one smaller router
  handoff: a nutrition card blocked by an unresolved device meal is a recovery
  turn, not a blank-totals dead end. The existing two skills still own every
  calorie, portion, clarification, safety, edit, totals, and card decision.
- The exact behavior head passed the synthetic two-turn live `gpt-5.6-terra`
  scenario: the first turn inspected the existing unresolved meal and asked for
  missing detail; the reply enriched that same meal, read it back, refreshed
  totals, and attached the card without adding a duplicate.
- Preliminary Product UX and prompt findings were resolved by deleting the
  duplicated global procedure. No service, state, schema, migration, retry
  machinery, or compatibility layer was added.

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

- Focused prompt/cache contract: 78 tests passed.
- Real-Codex file with the provider gate disabled: 6 passed, 82 skipped.
- Assistant-engine typecheck and `git diff --check`: passed.
- Complete initial provider input: 1 token and 26 UTF-8 bytes smaller in both
  representative direct and group requests.
- Opted-in exact behavior-head `gpt-5.6-terra` fixture: 1 passed, 87 skipped.
- Preliminary Product UX, prompt, and coverage specialist findings: resolved.
- Current-base `git merge-tree --write-tree`: clean before plan closure.
Completed: 2026-08-25
