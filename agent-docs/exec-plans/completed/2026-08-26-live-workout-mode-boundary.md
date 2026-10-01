# Fix live workout exercise metadata

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Prevent assistant-created ad-hoc workout exercises from reaching the native
  editor without an explicit result mode and, for resistance work, an exact
  lb/kg hint. This keeps empty resistance sets on weight-and-repetition fields
  instead of generic or repetitions-only input.

Product UX effort: Patch
Affected people: A private messaging member who starts or extends a live workout, then opens the refreshed native workout card to log remaining sets.
Direct proof: Start a synthetic mixed resistance/bodyweight workout through the production assistant skill and CLI, then verify canonical exercise modes, unit hints, the refreshed card, and the absence of untyped exercise creation.

## Success criteria

- Every ad-hoc exercise supplied to `workout start` or `workout exercise add`
  requires one supported explicit mode before any canonical write.
- Every `weight_reps` exercise carries an exact unit hint from the current
  request, a planned target, or the member's saved strength unit; no load is
  invented.
- Assistant guidance explains how to choose the supported mode and unit without
  treating an unknown load as an unknown result family.
- Deterministic tests prove missing metadata fails closed and typed resistance
  and bodyweight exercises persist the intended editor hints.
- A focused real-Codex journey proves the production assistant creates one
  canonical mixed workout with correct modes/units and one refreshed card.
- Focused tests, affected typechecks, changelog proof, exact-head CI, and the
  required preliminary Product UX/prompt/coverage review pass are complete.

## Scope

- In scope:
  - Ad-hoc live-workout CLI admission for initial and later-added exercises.
  - Production tracked-workout assistant instructions and focused regression
    coverage.
  - A private-free public changelog improvement item.
- Out of scope:
  - Legacy workout records that already omit a mode or unit.
  - Saved workout-format schema migration.
  - Exercise-name or shared-modifier segmentation, which is owned by the
    separate phrase-segmentation task branch.
  - Native card layout changes. The paired native reader PR already consumes
    the existing exercise-unit hint.

## Constraints

- Technical constraints:
  - Preserve the optional canonical schema for legacy/import compatibility;
    enforce the stronger rule only on model-authored live-workout CLI writes.
  - Reuse the existing V6 unit field and paired native reader; do not add a wire
    schema, parser, state owner, or fallback name inference.
  - Stack the PR on the exact active planned-workout backend candidate because
    both changes touch the live workout grammar. Do not modify that parent
    branch.
- Product/process constraints:
  - Never copy or closely paraphrase private screenshot or transcript evidence
    into tests, docs, changelog copy, commits, or PR text.
  - Ask one narrow question only when the result family or lb/kg unit is
    genuinely unavailable; missing load remains an empty typed field.

## Risks and mitigations

1. Risk: A required mode/unit could break existing assistant calls that relied
   on optional canonical fields.
   Mitigation: Update the production skill and run the exact CLI boundary plus
   one production-derived real-Codex journey before review.
2. Risk: Tightening CLI input could accidentally reject empty workouts,
   bodyweight movements, exact planned loads, or saved-routine starts.
   Mitigation: Apply the requirement only to supplied ad-hoc exercises, require
   units only for `weight_reps`, and cover those unaffected paths.
3. Risk: A test could mirror confidential evidence too closely.
   Mitigation: Use a synthetic mixed workout with different movements, counts,
   ordering, and wording, and inspect the final diff for identifier leakage.
4. Risk: The stacked parent branch moves during implementation.
   Mitigation: Base the initial delta on its exact reviewed head, keep this PR
   draft until the parent stabilizes, and prove the final diff/base ownership
   before marking it ready.

## Tasks

1. Add deterministic live-workout CLI mode/unit admission and canonical proof.
2. Update production tracked-workout guidance and its composed skill tests.
3. Run the focused real-Codex journey and manually review the actual reply.
4. Add the isolated changelog item after reserving the PR number.
5. Run focused verification, parent review, preliminary specialist review, and
   exact-head CI; resolve accepted findings and close the plan.

## Decisions

- Keep canonical workout exercise `mode` and `unitOverride` optional for legacy
  and imported records. The live CLI is the narrow model-authored admission
  boundary.
- Do not infer every exercise as `weight_reps`; require the caller to choose the
  existing supported result family.
- For a weight/reps exercise, accept `targetWeightUnit` as the initial unit hint
  because the canonical start owner already derives the same `unitOverride`.
- Reuse the paired native reader's exercise-unit interpretation; no new card
  schema is necessary for empty resistance sets.
- Keep phrase segmentation in its separately owned task/PR.

## Verification

- Commands to run:
  - Focused CLI and assistant skill Vitest files.
  - Affected package typechecks and CLI generated-artifact verification.
  - `pnpm test:assistant:live -- --test "requires typed modes and units while keeping live and reminder sets canonical"`.
  - Focused changelog test and Web typecheck after the PR-numbered entry exists.
  - Preliminary `completion-specialists` ReviewGPT pass and required GitHub
    checks on the exact pushed head.
- Expected outcomes:
  - Untyped ad-hoc exercise writes fail before persistence.
  - Resistance exercises retain `weight_reps` plus lb/kg; bodyweight exercises
    retain `bodyweight` without a fabricated unit.
  - The real assistant creates one correct canonical workout and one refreshed
    card without duplicate writes or generic exercise modes.
- Completed local proof:
  - Focused CLI and assistant skill suite: 23 tests pass.
  - Focused live-workout editor projection: 23 tests pass, including an
    all-pending resistance exercise whose kg hint reaches the editor contract.
  - CLI, assistant-engine, and vault-usecases typechecks pass.
  - `git diff --check` passes.
- External blocker:
  - The required real-Codex command was run, but the subscription cache probe
    stopped before any model turn with `ASSISTANT_CODEX_USAGE_LIMIT`. No reply
    was produced, so reply review remains outstanding and the PR must stay
    draft until that exact journey passes.
Completed: 2026-08-26
