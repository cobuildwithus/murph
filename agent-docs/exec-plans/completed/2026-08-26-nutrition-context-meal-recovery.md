# Recover nutrition context and incomplete meals

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Murph reuses current saved nutrition-suitability context before asking a
  member to repeat it, and resolves incomplete meals before presenting an
  interactive daily nutrition card as partial.

## Success criteria

- A numeric nutrition-target change performs one focused canonical-memory read
  before any suitability question and never expands into a universal clinical
  record scan.
- An interactive daily-card request with an incomplete saved meal first tries
  bounded recovery from accepted conversation context, the saved meal, and a
  matching prior meal. When evidence is still insufficient, Murph asks one
  focused identity-or-portion question instead of attaching a normal partial
  card with unavailable goal comparisons.
- Recovery updates the exact existing meal, reads it back, recomputes fresh
  totals, and attaches a card only from complete current data. Existing
  number-sensitive and scheduled-message boundaries remain intact.
- Deterministic prompt/skill tests, focused typecheck, and private-free live
  model journeys prove the changed behavior.
- The member-visible improvement has an accurate public changelog fragment,
  scoped commit, draft PR, required prompt/Product UX/coverage review, and
  exact-head CI evidence.

## Scope

- In scope:
  - Dynamic nutrition-card and numeric-target tool guidance.
  - Food-journal and automatic-meal-capture skill sequencing.
  - Focused deterministic and real-model assistant tests.
  - The owning durable messaging contract and one changelog fragment.
- Out of scope:
  - Nutrition card schema or renderer changes; partial cards remain readable
    for historical and explicitly requested partial-data use cases.
  - New persisted state, background jobs, provider integrations, or broad
    medical-record retrieval.
  - Re-estimating a meal solely because two informal meal names happen to
    match without current equivalence or ingredient/portion evidence.

## Constraints

- Technical constraints:
  - Keep the existing vault and meal CLI surfaces as the sole state owners.
  - Bound recovery to the selected date and relevant matching history.
  - Preserve truthful goal-status validation and all fresh-read requirements.
- Product/process constraints:
  - Treat the supplied screenshots and production trace as confidential
    evidence; do not copy their wording, values, or identifiers into durable
    artifacts.
  - This is a Product UX change because it changes the recovery conversation,
    not merely internal prompt wording.
  - Use the worktree/PR lane, Frog workflow, changelog workflow, assistant live
    verification, and prompt-primary specialist review.

## Risks and mitigations

1. Risk: Restoring the old universal clinical fanout would add latency and
   brittle reads.
   Mitigation: require only one canonical-memory read before an interactive
   suitability question, then permit another record family only for a concrete
   concern already raised by current evidence.
2. Risk: Historical similarity could make Murph invent current nutrition.
   Mitigation: require accepted current equivalence or matching saved
   ingredients and portion evidence before reusing an estimate; otherwise ask
   one narrow question.
3. Risk: Recovery questions could create unwanted proactive messages or expose
   numeric tracking to a member who suppressed it.
   Mitigation: make the generic recovery rule interactive-only, retain the
   existing scheduled-capture exception, and preserve number-sensitive
   suppression before any recovery question.
4. Risk: A partial-card compatibility path could be accidentally removed.
   Mitigation: retain the schema and renderer contract and allow partial data
   only when explicitly requested after the limitation is clear.

## Product UX plan

- Entry and promise: a member changes a nutrition target or asks for a daily
  summary; Murph should use what it already knows, repair recoverable gaps, and
  ask only for information that is truly missing.
- Established member with saved suitability context: Murph reads the canonical
  memory record, changes or proposes the target without repeating an already
  answered screening question, and gives a concise confirmation.
- Member with a recoverable incomplete meal: Murph uses accepted current
  context plus the exact saved meal and bounded matching history, updates that
  meal, refreshes totals, and returns one complete card.
- Member with a genuinely ambiguous meal: Murph asks one small identity or
  portion question, does not present partial totals as the finished day, then
  resumes the same-meal update and card after the answer.
- Member who suppresses numeric tracking: Murph does not ask a recovery
  question merely to enable numbers and continues the established nonnumeric
  path.
- Scheduled closeout: the existing automatic-capture recovery authority stays
  unchanged; the new generic question is not used to create a new proactive
  message.
- UX proof: deterministic effect assertions plus focused live-model reply
  review for repetition, action count, clarity, warmth, autonomy, and truthful
  recovery.

## Tasks

1. Patch the dynamic tool prompt so canonical memory precedes any interactive
   suitability question while broad clinical fanout remains forbidden.
2. Add selected-date incomplete-meal recovery to the food-journal owner and
   route automatic-meal closeout through it without widening proactive-message
   authority.
3. Add deterministic prompt and skill regression tests plus private-free
   production-derived real-model journeys.
4. Update the durable messaging contract and public changelog, run focused
   verification, inspect the diff for privacy and simplicity, and complete the
   PR review/CI lane.

## Decisions

- Root cause: the compact nutrition-safety rewrite removed both the expensive
  broad scan and the only targeted canonical-memory read. The remaining
  instruction moved directly from an incomplete context snapshot to a repeat
  question, despite the general resolve-before-asking rule.
- Root cause: partial nutrition totals are valid at the card contract, while
  mandatory recovery was scoped to automatic device captures. A normal
  interactive card could therefore terminate successfully with unavailable
  comparisons even when the conversation or bounded meal history could repair
  the saved meal.
- Use prompt sequencing and existing tools only. No schema, state owner,
  dependency, queue, or new runtime service is justified.

## Verification

- Commands to run:
  - Focused Vitest files for the dynamic tool catalog and both nutrition skills.
  - Focused assistant package typecheck/build command selected from the testing
    map.
  - `pnpm test:assistant:live -- --test "<focused nutrition recovery pattern>"`
    for each independent real-model journey.
  - Focused changelog loader/page checks and Web typecheck required by the
    changelog skill.
  - Exact-head required GitHub checks after the PR is marked Ready.
- Expected outcomes:
  - One targeted memory read before screening, zero universal clinical scans,
    no repeated established question.
  - Recoverable meal: one exact-meal update, fresh read/totals, one complete
    card, no duplicate question.
  - Ambiguous meal: one concise question, no partial card, no fabricated
    nutrition; a follow-up can complete the same meal.
  - Ready live-reply verdicts and green required CI on the candidate head.
Completed: 2026-08-26
