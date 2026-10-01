# Nutrition Card And Meal Capture Recovery

Status: completed
Created: 2026-08-24
Updated: 2026-08-25

## Goal

Keep a nutrition-card request or automatic meal capture from ending in a
recoverable dead end. A member with a proven compatible legacy target should
receive the requested card without changing Goal state, while a captured meal
should be re-identified and retried after a failed edit and retain a useful
evidence-based observation when numeric nutrition cannot be saved.

## Affected People And Journeys

- A member explicitly asking for today's nutrition card with a complete,
  compatible legacy target bundle.
- A member whose Goal target shape is genuinely ambiguous or would require a
  semantic target change.
- A member sending a meal photo that can support nutrition estimation but whose
  first canonical meal edit fails.
- A member sending a meal photo that supports only a nonnumeric food
  observation before the retained photo is removed.
- A scheduled closeout encountering the same legacy target or partially
  enriched meal states without a live member available for clarification.

## Tasks

1. Trace the current card target authority, automatic capture commands, meal
   schema, and prompt tests to identify the smallest existing owners.
2. Add a bounded read-only compatibility/recovery rule for proven target
   shapes; never silently rewrite Goal meaning or invent a target.
3. Add one bounded re-identification and retry path for failed meal enrichment,
   plus a nonnumeric observation fallback before evidence cleanup.
4. Add synthetic prompt-contract and scripted-runtime coverage without copying
   private feedback, screenshots, transcripts, or production records.
5. Publish a plain-language changelog item, run focused verification and
   provider-input measurement, then complete exact-head ReviewGPT and CI gates.

## Constraints

- Add no new service, queue, schema, state owner, compatibility writer, or
  dependency.
- Do not mutate a member's Goal merely to render a card, and do not reinterpret
  an ambiguous activity or rolling target as dietary guidance.
- Do not invent foods or nutrients. Persist only observations supported by the
  retained photo, member text, or an existing canonical record.
- Preserve automatic photo cleanup after the useful evidence-derived meal
  update has been read back; never delete evidence merely to make a failed
  enrichment look complete.
- Keep every fixture synthetic and free of member identifiers and distinctive
  incident wording.

## Verification

- Focused assistant-engine prompt, skill, response-card, and scripted-runtime
  tests covering success, bounded retry, evidence fallback, ambiguity, and
  fail-closed behavior.
- Focused changelog fragment tests and Web typecheck.
- Assistant-engine typecheck, provider-input measurement, and
  `git diff --check`.
- Parent diff review, preliminary Product UX/prompt/coverage ReviewGPT, final
  sensitive-behavior ReviewGPT, required GitHub checks, and current-base merge
  proof on the intended PR head.

## Outcome

- Kept compatibility read-only and narrow: only a complete historical daily
  bundle using rolling-window mean plus daily-aggregate mean may supply the
  existing point card; other statistics, mixed bundles, and ambiguous targets
  still fail closed without Goal mutation.
- Kept recovery in the existing prompt and tool owners: retry one malformed
  card call, and after one failed meal edit re-list, re-identify, retry once,
  and require read-back before photo cleanup.
- Preserved a concise evidence-based meal observation when nutrition cannot be
  estimated, while retaining the photo whenever the save cannot be proven.
- Reconciled the overlapping automatic-meal clarification change from `main`
  in the same prompt owner, preserving both the last-resort question and this
  task's bounded save recovery without new state or abstractions.
- Focused assistant-engine verification passed: four files with 45 tests, the
  scripted malformed-card recovery test, and package typecheck. Changelog
  fragment tests and hosted Web typecheck also passed.
- The provider-gated automatic-meal scenario was added but could not run
  locally because the required provider credential was unavailable. Final
  ReviewGPT round 2 passed with no findings; exact-head CI remains the merge
  gate after this plan-closing commit.
Completed: 2026-08-25
