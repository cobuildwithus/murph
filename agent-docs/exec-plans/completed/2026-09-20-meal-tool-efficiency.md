# Reduce avoidable meal tool work

Status: completed
Created: 2026-09-20
Updated: 2026-09-20

## Outcome and scope

Restore the existing meal workflow: use documented date filters and typed save
arguments, and inspect an available official nutrition page before falling back
to an estimate. Preserve numeric preferences, provenance, canonical save
readback, and browser authority. No new CLI, state, lookup service, or scheduler.

## Evidence and owner

The meal CLI owns date ranges through `--from` and `--to`. The food-journal
skill documents these only in later recovery guidance, while its capture path
lacks an explicit day-read recipe. The existing official-source journey returns
full nutrition on browser open and never exercises landing-page navigation.
The food-journal skill is the smallest owner for the workflow clarification;
existing CLI and computer tools already support the required operations.
Focused live proof also exposed skipped food-skill loading. The existing compact
router now names the exact file read before meal commands. Published official
facts explicitly use label provenance.

## Product UX

- Outcome: complete meal capture with less avoidable discovery and grounded nutrition.
- Reaches: new meal saves, explicitly requested day reads, exact-label misses,
  official landing pages, and preservation of the existing unavailable-source fallback.
- Proof: deterministic composed skill checks and focused real-Codex journeys
  using synthetic meals, CLI evidence, and browser responses. Numeric suppression
  and successful save-and-totals behavior remain covered.

## Implementation and proof

1. Add deterministic regression checks, then clarify the existing skill.
2. Extend the live day-read/save journey to reject wrong flags and unnecessary
   schema discovery. Strengthen official-source proof beyond the landing page.
3. Run focused tests and typechecks, review synthetic replies, and add a public
   outcome changelog entry. Skill bodies load after the first provider request;
   router changes require complete initial-input capture for direct and group
   fixtures; tool schemas remain unchanged.
4. Review the diff and complexity, close this plan, commit, open a draft PR,
   then mark Ready after focused proof and monitor exact-head required CI.

## Review and deployment

Prompt-primary scope uses parent candidate review and focused real-model proof.
Re-evaluate ReviewGPT eligibility if backend or independent sensitive behavior
changes. Skills ship in the ordinary runtime artifact; old and new runtimes
remain compatible, with no migration or consumer-first protocol requirement.

## Verification results

- Composed food-journal regression: 5 passed, including a red run before the skill change.
- Assistant Engine and hosted Web typechecks: passed.
- Changelog archive rendering: 10 passed using the repository-root Vitest config.
  The app-directory command discovers no files; this is already recorded in Frog.
- Complexity guard: passed; system-prompt debt 13 -> 13, maximum 28 -> 28.
  Existing hotspots buildStableRouteCapabilityPrompt (28) and
  buildAssistantHostedGroupGuidanceText (25) are unchanged; routing text adds no
  branch or state owner and does not justify unrelated refactoring.
- Live proof: five focused journeys passed with gpt-5.6-terra and local
  subscription auth: plain save, requested-day read/save, official item page,
  official landing-page navigation, and known numeric suppression. Initial
  samples exposed skipped skill loading and redundant CLI discovery; the
  final contract uses a direct skill-file command and complete save template.
  The final successful browser samples made no help/schema or CLI-source reads.
- Exact effects: one actual canonical meal and one card for each real-vault
  capture; one bounded date-range read only when requested; no duplicate save
  or confirmation reads. Official-source cases perform database lookup before
  browser access and save exact facts with label provenance plus source URL;
  the landing page requires one act and an item page requires none. Known
  numeric suppression performs one nonnumeric save without a lookup.
- Reply review: Ready. Replies are concise and truthful; saved preferences and
  declined-goal choices are respected. Restaurant/browser ports are synthetic;
  these runs do not prove third-party site availability or production latency.
- Live command: `pnpm test:assistant:live -- --test "<exact journey name>"`
  with the selected authenticated local subscription. The five exact names are
  the two `saves a nutrition-resolved meal without discovery; requested day read`
  variants, the two `uses the official restaurant source after an exact menu miss`
  variants, and `saves without nutrition in an already-known number-sensitive context`.
- Restaurant fixture batch contract: passed against the production result schema.
- Composed food/nutrition skills plus complete first-request capture: 15 passed.
- Complete provider request bytes: direct 159105 -> 159405 (+300, +0.189%);
  group 150101 -> 150401 (+300, +0.200%). Same scripted Codex request fixtures,
  excluding prompt_cache_key; registered tools unchanged. Exact Terra tokenizer
  unavailable, so no exact token counts or fabricated token deltas are reported.
- Candidate review: production scope is limited to the existing food skill and router;
  numeric suitability, browser authority, tool schemas, and persistence are unchanged.

## Completion

Final parent review preserved the existing skill, CLI, and browser owners. No new
CLI command or production state was necessary. Required exact-head CI remains
the PR completion gate; merge and deployment are outside this task.
Completed: 2026-09-20
