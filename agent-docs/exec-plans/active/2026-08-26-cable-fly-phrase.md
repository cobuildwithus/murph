# Parse shared exercise modifiers in workout logs

Status: active
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Make Murph preserve each intended exercise when a member dictates several
  ordinary position or angle variants with one shared exercise name.
- Keep the fix at the assistant interpretation boundary: no new parser, state,
  service, or workout-storage behavior.

## Success criteria

- A synthetic punctuation-free message with three coordinated exercise
  modifiers starts one workout containing all three exercises in order.
- Murph applies a clearly shared finite set and repetition prescription to each
  exercise and does not ask what ordinary position modifiers mean.
- Genuinely unresolved exercise identity or quantity allocation still produces
  one narrow clarification instead of invented workout data.
- Deterministic prompt coverage, one focused real-Codex journey, package
  typechecking, and public changelog validation pass.

## Scope

- In scope:
  - The tracked-workout skill's guidance for coordinated modifiers and noisy
    dictation.
  - Deterministic contract coverage and a focused real-Codex workout journey.
  - A privacy-safe public changelog fragment for the member-visible improvement.
- Out of scope:
  - Speech-to-text implementation, exercise taxonomy, or fuzzy database
    matching.
  - Changes to workout persistence, CLI commands, cards, or iMessage delivery.

## Constraints

- Technical constraints:
  - Reuse the existing tracked-workout skill and canonical `workout start`
    command surface.
  - Preserve the existing rule that unstated or genuinely ambiguous quantities
    are not guessed.
- Product/process constraints:
  - Treat the reported screenshot and message as confidential evidence; use
    only unrelated synthetic examples in repository artifacts.
  - Product UX effort: patch. Reaches: a private-chat member describing a
    multi-exercise workout compactly, and a member whose wording remains
    genuinely ambiguous. Proof: inspect the actual live reply, canonical
    workout exercises, set counts, and repetition facts.

## Risks and mitigations

1. Risk: Over-expanding a phrase that names one compound exercise.
   Mitigation: Limit expansion to ordinary coordinated modifiers that clearly
   share one exercise head; keep one narrow clarification for genuinely
   uncertain identity.
2. Risk: Applying one set or repetition prescription to the wrong exercise.
   Mitigation: Share quantities only when the grammar clearly assigns them to
   every expanded exercise; otherwise ask only for the missing allocation.
3. Risk: A prompt-only assertion passes while the real assistant still drops an
   exercise.
   Mitigation: Run the real Codex path and assert the canonical saved workout,
   attached card, command history, and user-visible response.

## Tasks

1. Trace the confidential report through the production skill, workout CLI,
   canonical write, card, and reply boundaries; identify and prove the owning
   gap without embedding the report.
2. Add the smallest tracked-workout instruction that expands clear coordinated
   modifiers while retaining narrow clarification for real ambiguity.
3. Add deterministic prompt coverage and a focused synthetic real-Codex
   journey, then inspect saved workout state and the actual reply.
4. Add and validate the public changelog fragment.
5. Run focused verification, parent review, the required preliminary Product
   UX/prompt/coverage specialist pass, and required PR checks.

## Decisions

- Keep the correction prompt-primary because the model already owns exercise
  interpretation and the existing command/storage surfaces accept an arbitrary
  ordered exercise list.
- Use a synthetic cable-press example for regression proof so confidential
  member language never enters the repository.
- Root cause: the tracked-workout skill required preserving distinct variants
  but did not define how punctuation-free coordinated modifiers map to distinct
  exercises. The model therefore had no explicit boundary between ordinary
  shared-head grammar and genuine exercise ambiguity; the CLI and canonical
  workout record already support the correct three-exercise result.

## Verification

- Commands to run:
  - Focused Vitest for the tracked-workout skill contract.
  - `pnpm test:assistant:live -- --test "expands coordinated workout exercise modifiers"`
  - Assistant-engine package typecheck.
  - Focused changelog validation and Web typecheck required by the changelog
    workflow.
  - `git diff --check` and required GitHub PR checks.
- Expected outcomes:
  - The skill contract states both the expansion and ambiguity boundaries.
  - The live journey saves exactly three ordered exercises with the shared
    prescription, attaches one complete workout card, and asks no clarification.
  - All focused checks and required CI pass on the pushed candidate head.
