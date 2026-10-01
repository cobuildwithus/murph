# Automatic meal clarification

Status: completed
Created: 2026-08-24
Updated: 2026-08-25

## Goal

Keep automatic meal capture useful when a retained photo cannot support an
honest nutrition estimate: remove the image on the existing privacy schedule,
ask one compact clarification, and use the answer to enrich the existing
canonical meal before recomputing any requested daily card.

## Evidence

- Automatic import correctly creates one canonical photo-backed device meal
  without inventing food identity or nutrition.
- The scheduled closeout inspects each selected photo and always replaces it
  with a privacy tombstone, but its current fallback rules prohibit questions.
- A visually ambiguous capture can therefore remain nutrition-empty after the
  only inspectable image is gone, while a later card request has no explicit
  recovery contract.

## Product UX plan

Effort: focused conversational recovery.

Irreducible purpose: a member who shared an ambiguous meal photo can provide
the missing facts and receive truthful nutrition tracking without duplicate
logging.

- A clear photo follows the current enrichment, cleanup, totals, and card path
  unchanged.
- Murph estimates conservatively whenever the photo supports a recognizable
  food or drink category and defensible portion range. Ordinary visual
  uncertainty does not trigger a question.
- When one or more selected photos are genuinely too indeterminate for any
  meaningful bounded estimate, Murph completes privacy cleanup and sends one
  compact question. It uses time on the occurrence date and date plus time for
  historical or multi-date captures. The question requests only the food or
  drink identity and approximate amount needed to estimate.
- A later answer or card request reuses the current conversation and canonical
  capture time to find the existing device meal. Murph asks one narrow question
  if essential facts are still missing; otherwise it edits and reads back that
  meal before obtaining fresh totals or attaching a card.
- Intuitive-eating, eating-disorder-risk, and number-sensitive behavior remains
  non-numeric and receives no estimate-enabling clarification. Duplicate and
  uncertain-nearby-meal safeguards remain unchanged.
- Several unresolved captures produce one compact, time-labeled clarification
  rather than several messages. No reply leaves the canonical meals unchanged;
  a later eligible interactive turn can recover them.

Done means the scheduled path no longer substitutes a generic closeout for an
unresolved capture, interactive recovery never creates a second meal, and
focused proof covers prompt ownership, cleanup ordering, and the managed
automation handoff. No visual artifact is useful for this text-only iMessage
behavior.

## Architecture

- Keep the canonical meal as the only persisted meal truth.
- Reuse the existing private conversation as the clarification continuation.
- Keep retained photos as the existing pre-cleanup work queue and preserve the
  privacy tombstone boundary.
- Add no database field, queue, cursor, flag, state machine, dependency, or
  second automation.

## Tasks

1. [x] Add one unresolved-capture clarification rule to the automatic-capture
   skill and remove the conflicting managed-automation fallback.
2. [x] Add focused prompt and automation regression proof, including ordering
   and no-duplicate recovery requirements.
3. [x] Run focused tests, assistant-engine typecheck, provider-input
   measurement, diff/privacy review, and the required exact-head review gates.
4. [x] Replay the Product UX journeys, resolve accepted findings, close this
   plan, and prepare the final PR candidate.

## Verification

- Focused automatic-capture skill and managed-automation tests.
- Focused production-shaped model scenario when the real-provider lane is
  available; otherwise retain it as credential-gated evidence and report the
  skipped lane.
- Assistant-engine typecheck, provider-input base/head measurement,
  `git diff --check`, privacy inspection, exact-head ReviewGPT specialist pass,
  required CI, and current-base merge-tree proof.

Completed candidate proof:

- The automatic-capture skill contract passed 4 tests; the focused managed
  closeout seed regression passed 1 test.
- Assistant-engine typecheck passed.
- The public changelog fragment passed 57 focused fragment, registry, page, and
  route tests; Hosted Web typecheck passed.
- `git diff --check` and the scoped privacy/path scan passed.
- Vercel ignored the changelog-only preview, the documented `agent-browser`
  binary was unavailable, and the in-app browser exposed no browser instance.
  The existing server-rendered archive tests are the available presentation
  proof; current-branch browser proof remains an explicit review gap.
- The preliminary specialist review returned three accepted findings: inherit
  protected-context estimation eligibility, disambiguate historical captures
  by date and time, and add production-shaped two-turn model proof. The prompt
  and tests now implement all three corrections without new runtime state.
- The real-Codex test module compiles and now contains the scheduled
  cleanup/question/stop, reply/edit/readback/fresh-totals journey plus the
  protected-context suppression branch. No supported provider credential is
  present locally, so the paid model call remains skipped under the repository's
  documented opt-in gate.
- The deferred skill is 4,750 `o200k_harmony` tokens / 21,940 UTF-8 bytes,
  +383 / +1,864 from `origin/main`. Ordinary private and group provider inputs
  remain unchanged because this skill is deferred.

## Product UX walkthrough

Result: Ready for final exact-head CI.

- Clear captures remain on the existing enrichment and card branch because the
  new gate treats a recognizable category and defensible portion range as
  enough for a bounded estimate; ordinary uncertainty does not ask a question.
- An unresolved scheduled capture completes photo cleanup, asks one compact
  clarification, and stops before Goal, totals, or card work. Focused ordering
  assertions cover that path.
- A later answer or blocked card request finds and edits the existing device
  meal, reads it back, and uses fresh canonical totals. Prompt assertions cover
  tombstoned attachments, narrow questions, and no replacement meal.
- Intuitive-eating, eating-disorder-risk, and number-sensitive contexts clean
  the photo and stop without an estimate-enabling question, Goal read, totals,
  or card. Historical and multi-date questions include date and time. Duplicate
  and nearby-meal safeguards are unchanged.

## Parent final review

- All three accepted specialist findings are resolved at the existing skill and
  proof owners; the preliminary pass returned no patch artifact and is not
  rerun under the one-pass rule.
- The final diff retains one meal owner, one privacy-cleanup boundary, and the
  existing conversation continuation. It adds no production state, service,
  queue, dependency, or tool contract.
- Focused prompt and automation tests pass, assistant-engine typecheck passes,
  the real-Codex scenario compiles under its documented credential gate, and
  `git diff --check` plus the scoped privacy scan pass.
- Remaining proof gap: the opt-in live-provider scenario could not run locally
  because neither supported provider credential is present. Exact-head CI owns
  the broad deterministic suite.
Completed: 2026-08-25
