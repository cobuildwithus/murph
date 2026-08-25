# Automatic meal clarification

Status: active
Created: 2026-08-24
Updated: 2026-08-24

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
- When one or more selected photos cannot support an honest estimate, Murph
  completes privacy cleanup and sends one compact question, using capture time
  only when needed to distinguish meals. The question requests only food or
  drink identity and the approximate amount or ingredients needed to estimate.
- A later answer or card request reuses the current conversation and canonical
  capture time to find the existing device meal. Murph asks one narrow question
  if essential facts are still missing; otherwise it edits and reads back that
  meal before obtaining fresh totals or attaching a card.
- Intuitive-eating, eating-disorder-risk, and number-sensitive behavior remains
  non-numeric. Duplicate and uncertain-nearby-meal safeguards remain unchanged.
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
3. [ ] Run focused tests, assistant-engine typecheck, provider-input
   measurement, diff/privacy review, and the required exact-head review gates.
4. [ ] Replay the Product UX journeys, resolve accepted findings, close this
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
- No live-provider model scenario has run. The current direct proof validates
  prompt ownership, cleanup ordering, the no-duplicate continuation, and the
  managed automation handoff rather than sampled model output.

## Product UX walkthrough

Result: Ready for exact-head specialist review.

- Clear captures remain on the existing enrichment and card branch because the
  new gate applies only after inspection cannot support an honest estimate.
- An unresolved scheduled capture completes photo cleanup, asks one compact
  clarification, and stops before Goal, totals, or card work. Focused ordering
  assertions cover that path.
- A later answer or blocked card request finds and edits the existing device
  meal, reads it back, and uses fresh canonical totals. Prompt assertions cover
  tombstoned attachments, narrow questions, and no replacement meal.
- Existing intuitive-eating, eating-disorder-risk, number-sensitive, duplicate,
  and nearby-meal safeguards are unchanged.
