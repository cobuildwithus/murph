# Gate recurring-reminder cadence policy on delivered history

Status: active
Created: 2026-08-27
Updated: 2026-08-27

## Outcome

- The first ordinary recurring reminder sends only the saved cue. A cadence
  question can appear only after the host supplies a confirmed delivered output
  from the same automation revision and conversation session.

## Reaches

- Scheduled private and group ordinary reminders across supported assistant
  models. Medication, prescribed-treatment, clinical, and safety-critical
  exclusions remain unchanged, as does the later skip after an unanswered
  cadence question.

## Proof

- Deterministic composed-prompt regressions prove the first occurrence omits the
  silence/cadence branch and later occurrences include it with delivered
  history. A production-derived focused live Luna journey verifies the actual
  first-occurrence reply.

## Product UX

- Effort: Patch. This restores the existing promise that a newly created
  recurring reminder begins with its requested cue instead of immediately
  questioning whether the conversation should continue.
- Private and group recipients both get the requested first cue without an
  unexpected administration question. Later unanswered-reminder behavior and
  room-scoped language stay intact.

## Root cause

- The recurring-reminder execution prompt always exposed both first-occurrence
  and later silence branches. Output-history enrichment ran afterward and
  correctly returned no history on occurrence one, but the model could still
  choose the unconditional later cadence-question instruction.

## Approach

- Keep direct-completion and safety guidance in the ordinary recurring-reminder
  execution overlay.
- Let the existing confirmed-output-history owner append silence/cadence policy
  only when it also appends a delivered output from the same eligible scope.
- Add no persisted state, lifecycle, counter, dependency, or new authority.

## Tasks

1. Add a failing deterministic regression for the composed first-occurrence
   provider prompt.
2. Split and conditionally compose the cadence policy at the existing output
   history boundary.
3. Add a production-derived focused live Luna journey and inspect its visible
   reply.
4. Run focused tests and typecheck, review the privacy-safe diff, commit, push,
   and complete the required PR review and CI gates.

## Risks and mitigations

1. Risk: moving too much policy could weaken direct completion or clinical
   exclusions on the first occurrence.
   Mitigation: keep those rules resident and assert them in the first-occurrence
   composed prompt.
2. Risk: generic automation history could enable cadence policy for a task that
   is not an ordinary reminder.
   Mitigation: gate enrichment on an explicit host-owned marker emitted only by
   the recurring-reminder execution builder.
3. Risk: a handwritten live prompt could diverge from production composition.
   Mitigation: build the live journey input through the same production
   notification preparation function used at runtime.

## Verification

- Focused assistant cron output-history and runtime tests.
- Assistant-engine TypeScript check.
- One uniquely named `gpt-5.6-luna` live assistant journey for the first
  ordinary recurring-reminder occurrence.
- Preliminary prompt, Product UX, and coverage specialist review; exact-head CI
  and any additional review gate required by the final change shape.
