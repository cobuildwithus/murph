# Collapse strength set logging to one canonical owner

Status: active
Created: 2026-08-23
Updated: 2026-08-23

## Goal

Make every accepted strength-set confirmation stay with the canonical owner
already established by the conversation. Remove overlapping prompt routes
instead of adding another selector, state record, or reconciliation path.

## Product UX Patch

- A member continuing an exact live workout gets every accepted set written to
  that same workout and receives its verified workout card.
- A member completing an explicitly regimen- or experiment-owned occurrence
  keeps the existing occurrence flow when no live workout owns the exchange.
- If neither owner is exact, Murph asks one narrow clarification and writes
  nothing instead of claiming success or switching record types.

## Architecture

- `activity_session` remains the only mutable owner for a live workout.
- The existing regimen or experiment remains the owner for a scheduled
  repeated occurrence outside a live workout.
- `strength-training` makes this owner choice once. `tracked-table` and
  `experiment-onboarding` execute their existing canonical write paths.
- Delete strength-specific target-selection policy from
  `behavior-followthrough`; it remains the generic owner for recurring support.
- Add no schema, persisted state, runtime selector, compatibility layer, or
  repair job.

## Scope

- In scope: assistant skill routing, prompt discovery text, focused synthetic
  and real-model regression coverage, and a public reliability changelog item.
- Out of scope: historical data repair, workout schemas and CLI commands,
  experiment schemas, response-card rendering, or production backfills.

## Verification

- Focused assistant-engine skill and real-model workout tests.
- Assistant-engine and Web typechecks for changed owners.
- Changelog validation, `git diff --check`, and a direct privacy scan.
- Product UX walkthrough for live-workout success, explicit repeated-routine
  success, and ambiguous recovery.
- Preliminary Product UX, prompt, and coverage ReviewGPT lenses plus green
  required exact-head CI.

## Decisions

- The owner gate lives in `strength-training`, before either execution path is
  loaded. This removes the overlapping interpretation instead of adding a
  selector after conflicting writes are possible.
- `tracked-table` repeats only the live-workout invariant needed at its write
  boundary. `behavior-followthrough` no longer selects strength exercises.
- The resident router replaces two overlapping lines with one shorter owner
  rule, keeping the stable prompt below its existing byte ceiling.

## Local evidence

- Focused assistant skill and prompt tests: 89 passed.
- Assistant Engine typecheck: passed.
- The focused real-model scenario is collected but skipped locally because no
  provider credential is configured in this checkout.
- Changelog fragment validation: 7 passed.
- Hosted Web typecheck: passed.
- Product UX walkthrough: exact live-workout context remains on the same
  workout and ends in its verified card; exact repeated-routine context keeps
  its occurrence owner; missing exact ownership asks one question and writes
  nothing. Group privacy behavior is unchanged.
- Changelog: added a priority-3 reliability item. No visual is needed because
  this narrow routing correction is explained more clearly in two sentences
  and introduces no new interaction or presentation.
