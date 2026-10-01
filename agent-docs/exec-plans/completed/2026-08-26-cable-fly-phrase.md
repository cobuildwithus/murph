# Parse shared exercise modifiers in workout logs

Status: completed
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
- Preliminary ReviewGPT first returned `INVALID` because its generated archive
  omitted the mandatory assistant-verification skill. The corrected exact-head
  package returned three substantive findings. All were accepted: keep Product
  UX on Hold until the live journey runs, consolidate the conflicting quantity
  guidance into one owner, and tighten plus print the live reply proof.
- The corrected prompt now treats one exact count clearly assigned to every
  exercise as unambiguous, and asks only when the count conflicts, is inexact,
  or its allocation is unclear. The shared-head rule now owns exercise identity
  only, removing the conflicting duplicate quantity instruction.
- Live-path diagnosis found two fixture-only failures before product behavior
  could be judged: the synthetic CLI used a sandbox-incompatible TypeScript IPC
  path, then depended on per-turn environment values that a reused app server
  did not retain. The fixture now invokes the reviewed loader directly and
  embeds only its session-owned synthetic paths in its generated wrapper.
- A live recovery attempt also exposed an avoidable command error: an ad-hoc
  inline plan could be passed as a saved routine lookup before retrying with
  exercises. The skill now reserves `--routine` for an already resolved saved
  format and requires one repeated `--exercise` input per ad-hoc exercise.
- Product UX is Ready after the focused journey passed under a separate
  authenticated local subscription home. The synthetic clear case produced one
  active workout, three ordered exercises, six pending 10-repetition targets,
  one structured card, no companion prose, and no runtime issues. The ambiguous
  follow-up asked one allocation question and made no canonical mutation.

## Verification

- Passed:
  - Focused tracked-workout skill Vitest: 3 tests passed. The contract proves
    the consolidated allocation rule and rejects the former conflicting text.
  - Assistant-engine package typecheck.
  - Changelog production archive test: 9 tests passed.
  - Hosted Web typecheck.
  - Privacy readback and `git diff --check` on every committed candidate.
  - Corrected exact-head preliminary Product UX/prompt/coverage ReviewGPT pass
    completed with findings; every substantive finding was accepted and the
    code/test remediation was applied. Per the one-pass rule it is not rerun.
  - `pnpm test:assistant:live -- --test "expands coordinated workout exercise modifiers"`
    passed with `gpt-5.6-terra` through a separate authenticated local
    subscription home: one workout with the three expected exercises, two sets
    and 10 repetitions per exercise, one complete quiet card, zero runtime
    issues, and no mutation or card for the allocation-ambiguous follow-up.
  - Focused prompt contracts after the live-path fixes: 78 tests passed across
    tracked-workout, exercise-catalog, and resident-routing coverage.
  - Assistant-engine package typecheck after the live-path fixes.
  - `git diff --check` after the live-path fixes.
- Completion:
  - Exact candidate `39aaefab59b9e2573188c104aad49615d6418588` was
    committed and pushed, and PR #2340 now records the Ready Product UX result,
    live evidence, affected surfaces, provider-input impact, and current change
    shape.
  - Parent final review found no remaining correctness, privacy, architecture,
    or proof gap. The separate cross-cutting gate is not applicable under the
    prompt-primary and test-fixture exemption; the required preliminary
    Product UX/prompt/coverage pass is complete and its accepted findings are
    resolved.
  - Plan closure is the remaining behavior-preserving documentation commit;
    exact-head CI and current-base merge proof remain PR admission checks.
Completed: 2026-08-26
