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
- A member replying to an exact saved-workout reminder gets a new workout from
  that format, while an unrelated older unfinished workout stays untouched.
- A member completing an explicitly regimen- or experiment-owned occurrence
  keeps the existing occurrence flow when neither workout path owns the
  exchange.
- If neither owner is exact, Murph asks one narrow clarification and writes
  nothing instead of claiming success or switching record types.

## Architecture

- `activity_session` remains the only mutable owner for a live workout.
- An exact `workout_format` reminder starts a new `activity_session`; the format
  is a template and never becomes a second mutable set-log owner.
- The existing regimen or experiment remains the owner for a scheduled
  repeated occurrence, including when its reminder also references a workout
  format as a template.
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
- Accepted preliminary Product UX and prompt finding: preserve the existing
  exact `workout_format` reminder path inside the same exclusive owner gate.
- Accepted preliminary coverage finding: extend the provider-backed workout
  scenario through format read, workout start, set log, card verification, and
  proof that an older unfinished workout remains unchanged. The scenario
  collects and compiles locally; execution requires a supported provider API
  credential that is not configured in this checkout.
- Accepted final owner-boundary finding: experiment and regimen ownership takes
  precedence over a supporting workout-format reference. This uses existing
  reminder provenance and adds no selector or state.
- Accepted final coverage findings: the provider scenario now uses the
  production-shaped prior-delivery context, asserts exact format-read, start,
  and set-log identity in order, and checks the completed card's exercise and
  set presentation. A second provider scenario proves a mixed experiment plus
  workout-format reminder issues only the experiment occurrence write.
- Rejected as out of scope: changing completed-card runtime rehydration or
  exporting the private production context builder solely for this regression.
  Those are broader trust-boundary/API changes; this patch directly verifies
  the card contents and mirrors the production-composed context while existing
  tests continue to own the context builder itself.

## Local evidence

- Focused assistant skill and prompt tests: 89 passed.
- Assistant Engine typecheck: passed.
- The focused standalone-format and mixed-owner real-model scenarios collect
  but skip locally because no provider credential is configured in this
  checkout.
- Changelog fragment validation: 7 passed.
- Hosted Web typecheck: passed.
- Product UX walkthrough: exact live-workout context remains on the same
  workout and ends in its verified card; an exact saved-workout reminder starts
  a new workout and leaves an unrelated unfinished workout unchanged; exact
  regimen or experiment context keeps its occurrence owner even when its
  reminder includes a workout template; missing exact ownership asks one
  question and writes nothing. Group privacy behavior is unchanged.
- Changelog: added a priority-3 reliability item. No visual is needed because
  this narrow routing correction is explained more clearly in two sentences
  and introduces no new interaction or presentation.
