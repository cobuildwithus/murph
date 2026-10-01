# Make experiment, Habitat, and Murph Age CLI failures model-repairable

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Return stable, bounded, field-specific CLI failures for proven experiment,
  Habitat, and Murph Age error paths so a model can repair its next command
  without mistaking invalid input for success or receiving raw values/paths.

## Success criteria

- `age evidence` rejects invalid top-level values and malformed recognized
  wrapper fields before analysis.
- Age submitted-input schema failures identify bounded field paths without raw
  Zod issue serialization or submitted values.
- Model-card artifact warnings preserve safe failure categories without file
  paths, artifact content, or parser prose.
- Experiment start option and existing-record conflicts, Habitat owner errors,
  and progress-card stages return stable repair codes and guidance.
- Focused final-envelope, non-echo, and truthful-success tests pass with the
  affected package typechecks.
- The active plan is archived and all task files are committed through
  `scripts/finish-task`.

## Scope

- In scope: owner-local mappings in `packages/cli`, `packages/vault-usecases`,
  and `packages/query`; focused CLI/usecase tests; generated CLI artifacts only
  when required by the normal commit hook.
- Out of scope: command topology changes, new persisted state, provider or
  hosted runtime behavior, broad error-framework redesign, PR creation,
  pushing, ReviewGPT, and unrelated generic-error paths.

## Constraints

- Technical constraints: reuse the foundation's shared repair-detail contract;
  never expose input values, local paths, artifact content, or native render/fs
  messages; preserve successful command envelopes and existing canonical owners.
- Product/process constraints: Product UX Patch. Outcome: existing CLI recovery
  becomes truthful and actionable. Reaches: models/operators using failed
  experiment, Habitat, and Murph Age commands. Proof: focused full-output
  envelopes plus non-echo and success regressions. Preserve the open foundation
  PR as the exact base and do not push or open another PR.

## Risks and mitigations

1. Risk: broader catches could misclassify unknown internal failures.
   Mitigation: map only proven owner codes and explicit parsing/render stages;
   let unrecognized failures retain the foundation's bounded internal fallback.
2. Risk: richer repair details could echo private input or filesystem context.
   Mitigation: construct allowlisted field paths and stage/category enums, then
   assert forbidden synthetic values and paths are absent from final envelopes.
3. Risk: warning reclassification could turn ordinary missing model artifacts
   into a failure.
   Mitigation: preserve missing-directory-as-empty behavior and add a truthful
   success regression.

## Tasks

1. [x] Inspect the foundation repair contract and affected owner/test seams.
2. [x] Implement the bounded owner-local mappings for Age, experiment, Habitat,
   and progress-card failures.
3. [x] Add focused final-envelope, non-echo, and truthful-success coverage.
4. [x] Run focused tests, affected package typechecks, diff/privacy review, and the
   Product UX walkthrough.
5. [ ] Archive the plan and create one scoped commit with `scripts/finish-task`.

## Decisions

- No new broad error framework: extend the foundation repair contract only to
  let existing vault-code mappings carry repair details, and keep domain
  classification with current command/usecase owners.
- Missing model-card artifact directories remain a normal empty state.
- Rebased the completed patch without conflict onto foundation head
  `f7cd7a10e91f2c72ae0c71300b983fbcb93d442d` before final verification.

## Verification

- Commands to run: focused CLI and vault-usecase Vitest files; package-local
  `packages/cli`, `packages/vault-usecases`, and `packages/query` typechecks as
  touched; `git diff --check`; focused synthetic full-output command scenarios.
- Expected outcomes: stable non-`UNKNOWN` repair codes for every proven path;
  no raw synthetic values or paths in envelopes; valid inputs still succeed;
  no unrelated changes.

## Verification results

- CLI source tests: Murph Age 23/23; Habitat and progress-card 9/9;
  experiment/journal/vault 44/44, plus the final focused recovery rerun 2/2.
- Query Murph Age runtime tests: 35/35.
- Vault-usecase public helper seam tests: 6/6.
- Package typechecks: CLI, query, and vault-usecases passed after the final
  refactor and foundation rebase.
- Product UX replay: invalid submitted Age fields identify the exact JSON field;
  invalid experiment options and conflicts identify the repairable option or
  slug; malformed Habitat records route to validation; model-card warnings name
  safe artifact categories; progress-card corruption routes to the dry-run
  repair command. Optional missing model-card directories and valid save/render
  journeys remain successful.
- Synthetic private values, artifact content, and paths were asserted absent
  from full error envelopes; `git diff --check` passed.
Completed: 2026-08-24
