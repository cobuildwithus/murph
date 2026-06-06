# CLI UX fixes for assistant-facing command use

Status: active
Created: 2026-06-06
Updated: 2026-06-06

## Goal

- Fix only the assistant-facing CLI UX issues that are supported by current
  code evidence.
- Keep the implementation small and owner-local: command copy in
  `packages/cli`, command-shaped normalization in `packages/vault-usecases`,
  canonical mutation semantics in `packages/core`, and read-side behavior in
  `packages/query` only when the read model is the source of the issue.
- Delete speculative work from the plan instead of preserving it as future
  process.

## Success criteria

- Murph gets precise, privacy-safe errors for failed repeated structured
  inputs.
- Typed update commands do not silently erase or reset existing data because an
  omitted field was interpreted as a replacement value.
- Generated examples that remain in scope are shell-copyable.
- The implementation adds no new CLI framework, no new dependency, no new
  state, and no broad compatibility layer.

## Explicit non-goals

- Do not fix the compact assistant discovery manifest. Murph can run targeted
  `--help`, `--schema`, and `--llms-full` commands when it needs details.
- Do not redesign command topology, replace incur rendering, or add a command
  adapter layer.
- Do not change tested product semantics such as capture label lookup resolving
  to the latest matching capture unless a separate product decision asks for
  that behavior change.
- Do not pursue device, experiment, or automation changes that current source
  and tests already handle.

## Code evidence checked

- `packages/vault-usecases/src/usecases/explicit-health-family-services.ts`
  still throws the generic message `--ingredient failed validation.` for
  schema-invalid `supplement save --ingredient` JSON.
- `packages/cli/test/supplement-save-typed-parity.test.ts` currently asserts
  only the generic validation wording and non-echo behavior, so a narrower
  error-path improvement is unblocked.
- `packages/vault-usecases/src/usecases/record-mutations.ts` applies `set`
  entries and then `clear` entries without rejecting same-field conflicts.
- `packages/cli/src/commands/food.ts`, `packages/cli/src/commands/recipe.ts`,
  and `packages/cli/src/commands/meal.ts` build typed edit commands through the
  shared set/clear patch path, so one shared conflict guard is enough.
- `packages/cli/src/commands/food.ts` builds `food save` payloads with
  `status: input.status ?? 'active'`, which means a typed update can reset an
  archived food to active unless the caller resends status.
- `packages/cli/src/commands/recipe.ts` does not force the default status in
  the typed save builder, and the recipe usecase/core path already preserves an
  existing status when the option is omitted.
- `packages/vault-usecases/src/option-utils.ts` already has
  `normalizeRepeatableTextFlagOption`, and
  `packages/vault-usecases/test/option-utils.test.ts` proves it preserves
  commas in prose values.
- `packages/vault-usecases/test/capture.test.ts` explicitly tests stable labels
  resolving to the latest capture for `show` and `manifest`; that is current
  product behavior, not an accidental UX bug.
- `packages/cli/src/commands/device.ts` already rejects `device connect
  junction` and distinguishes connect targets from live provider keys.
- `packages/cli/test/device-cli.test.ts` already covers `device connect
  junction` rejection and provider/filter distinctions.
- `packages/cli/src/commands/experiment.ts` already requires explicit
  `--from-protocol` or `--custom --no-public-protocol` and rejects custom
  starts with protocol-only revision options.
- `packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts`
  already covers those experiment source and fallback guards.
- `packages/cli/src/commands/automation.ts` requires deliverable routes,
  rejects private placeholders, and current tests assert shell-copyable
  examples for `automation save`.
- `packages/core/src/automation.ts` already preserves existing schedule, route,
  summary, tags, status, and continuity policy on update when the core input
  omits them; the typed CLI path still requires instructions and schedule, so
  any automation update change should be a separate focused design decision.

## Workstreams

### 1. Improve supplement ingredient validation

Confirmed problem:
- `supplement save --ingredient` reports a generic validation message when one
  repeated JSON object fails schema validation.
- Murph needs to know which repeated item and safe field path failed, without
  echoing the raw supplement label or payload.

Minimal fix:
1. Change the supplement ingredient parser to include the repeated item index
   in validation failures, for example `--ingredient #2 failed validation`.
2. Include safe schema issue paths such as `unit` or `amount`, not raw payload
   text.
3. Add a special hint when the failing issue is on `unit`: keep units compact
   such as `mcg`; put qualifiers such as `DFE` in `note`.
4. Keep malformed JSON and array-shape errors as they are unless the new helper
   can improve them without broadening scope.

Tests:
- Update the existing supplement invalid-ingredient test to assert item index,
  field path, unit hint, and no raw payload echo.
- Keep the existing array and malformed JSON coverage.

Owner boundary:
- Prefer a small local helper beside `parseSupplementIngredients`.
- Do not introduce a generic validation framework unless another touched
  repeated JSON parser has the same confirmed problem.

### 2. Reject same-field set/clear edit conflicts once

Confirmed problem:
- The shared record patch path applies `set` before `clear`.
- A typed command can set `ingredients` and clear `ingredients` in the same
  invocation; the clear wins silently.

Minimal fix:
1. Add a conflict guard in `applyRecordPatch` before applying file, set, or
   clear mutations.
2. Reject exact conflicts such as `ingredients=value` plus
   `--clear-ingredients`.
3. Also reject parent/child conflicts such as `nutrition.perServing.calories`
   plus `--clear-nutrition`, because clear currently deletes the parent after
   the child is set.
4. Return a concise error naming the conflicting paths and options.

Tests:
- Add focused usecase tests for `applyRecordPatch`.
- Add one CLI-level regression through a representative typed edit command,
  preferably `meal edit` or `food edit`, to prove the generated typed path
  reaches the shared guard.

Owner boundary:
- Put the invariant in `packages/vault-usecases/src/usecases/record-mutations.ts`.
- Do not copy guards into every command builder.

### 3. Preserve food status on typed food updates

Confirmed problem:
- `buildFoodSavePayload` defaults status to `active` before it knows whether
  this is a create or update.
- `packages/core` can preserve existing status when status is omitted, but the
  CLI never omits it on typed `food save`.

Minimal fix:
1. Change `buildFoodSavePayload` so `status` is only supplied when the caller
   passed `--status`.
2. Ensure create behavior still defaults to active through the core food
   upsert path.
3. Add/update help wording only if needed: omitted scalar fields preserve on
   update, and create defaults still apply on create.

Tests:
- Add a focused food typed-save test:
  - create or import an archived food;
  - update it with `food save --id ...` while omitting `--status`;
  - assert the status remains archived.
- Keep existing create tests proving new foods default to active.

Owner boundary:
- This is a `packages/cli/src/commands/food.ts` payload-builder fix.
- Do not change `packages/core` unless a failing test proves core cannot
  preserve omitted status.

### 4. Keep generated examples copy-safe only where unproven gaps remain

Current evidence:
- `automation save` already has a test asserting quoted multi-word args and
  instructions.
- Several command descriptions already tell Murph to shell-quote repeatable
  prose values.
- The earlier `intervention add` concern still needs source-first proof in this
  worktree because the built CLI artifact is not present.

Minimal fix:
1. Add a source-first test for `intervention add --llms-full` if no existing
   test already covers the rendered example.
2. If the example is unquoted, fix the command example metadata directly.
3. Do not add a broad renderer contract test unless two or more commands prove
   the same renderer bug.

Tests:
- A single focused CLI metadata test for `intervention add` is enough unless
  another copied example is proven broken.

Owner boundary:
- Keep this in `packages/cli` command metadata/tests.
- Do not modify incur or add a command-rendering abstraction from one bad
  example.

## Deleted from the original plan after code review

- Capture label ambiguity: current tests intentionally resolve duplicate
  labels to the latest capture.
- Device connect/provider redesign: current code and tests already reject
  `junction` as a connect target and distinguish provider key classes.
- Wearables Fitbit read-filter work: current provider filter set intentionally
  comes from `wearablePreferenceProviderValues`, which excludes Fitbit. This is
  a product/provider support decision, not a CLI UX cleanup.
- Experiment custom/public fallback redesign: current code and tests already
  require explicit fallback flags and reject protocol-only options on custom
  starts.
- Broad assistant runtime command exposure: status, doctor, stop, run, and
  self-target commands are already present in the assistant command surface.
- Automation sparse-update redesign: core already supports preserving omitted
  fields, while the typed CLI save path is intentionally create-shaped today.
  Change it only under a separate focused task if the desired UX is sparse
  automation editing.
- Regimen update semantics broadening: `regimen save` currently exposes a
  single primary ingredient field set rather than the repeated supplement JSON
  list. Do not force it to mirror `supplement save` unless a concrete user path
  needs that behavior.

## Proposed implementation order

1. Supplement ingredient validation message and tests.
2. Shared set/clear conflict guard and tests.
3. Food status preservation on typed update and tests.
4. `intervention add` example proof/fix if the focused metadata test fails.

## Verification plan

- For each implemented code change:
  - Run the focused package tests for the changed command/usecase.
  - Run `pnpm test:diff <touched paths>` when it truthfully covers the touched
    owners.
  - Run `pnpm typecheck` before handoff.
- For this Markdown-only plan update:
  - Read back the plan.
  - Run `git diff --check` on the docs diff.

## Completion reviews

- For future code implementation:
  - Run coverage-write if code/test changes touch package owners.
  - Run task-finish-review before final handoff.
  - Add security-privacy-review only if the implementation touches runtime
    status, self-targets, delivery routing, provider identities, or device
    account surfaces.
- For this plan-only PR update:
  - No completion-review subagent is required by the docs-only fast path.

## Open questions

- Should `automation save` remain create-shaped, or should a separate
  `automation edit`/sparse-update command exist?
- Should capture label lookup continue to mean latest-by-label? Current tests
  say yes; changing it needs a product decision.
- Should Fitbit become a first-class wearable provider filter? Current
  contracts say no.

## Working set

- Likely implementation files:
  - `packages/vault-usecases/src/usecases/explicit-health-family-services.ts`
  - `packages/vault-usecases/src/usecases/record-mutations.ts`
  - `packages/cli/src/commands/food.ts`
  - `packages/cli/src/commands/intervention.ts`
- Likely tests:
  - `packages/cli/test/supplement-save-typed-parity.test.ts`
  - `packages/vault-usecases/test/**`
  - `packages/cli/test/food-save-typed-parity.test.ts`
  - `packages/cli/test/cli-expansion-intervention.test.ts`
