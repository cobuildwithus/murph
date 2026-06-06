# CLI UX fixes for assistant-facing command use

Status: active
Created: 2026-06-06
Updated: 2026-06-06

## Goal

- Fix the confusing CLI UX issues found in the assistant-facing command audit,
  excluding the broad agent-facing discovery-manifest work.
- Keep the work simple: improve command semantics, error messages, examples,
  and focused tests at the existing owner boundaries instead of adding a new
  CLI abstraction.

## Success criteria

- Murph can call the high-value CLI commands without avoidable trial and error.
- Repeated structured inputs identify the failing field and item without
  echoing raw payloads.
- Generated help and LLM examples are copy-safe for multi-word values,
  repeatable flags, and boolean flags.
- Update commands clearly distinguish preserve, replace, and clear semantics.
- Device/wearable commands no longer invite Murph to use plumbing provider
  names as user-facing connect or read targets.
- Experiment setup/logging help closes the most likely assistant traps around
  protocol fallback, local session dates, and public/private protocol routing.

## Explicit non-goal

- Do not fix the compact assistant CLI discovery manifest in this plan.
  If Murph is missing command details, it can run targeted `--help`, `--schema`,
  or `--llms-full` commands. This plan only fixes the command surfaces and
  command behavior those lookups reveal.

## Scope

- In scope:
  - Supplement/regimen validation, stop lookup, compound lookup ambiguity, and
    regimen save guidance.
  - Food/meal/recipe/capture edit conflicts, validation paths, comma handling,
    and record-choice guidance.
  - Device/wearable provider naming and connect-target guidance.
  - Experiment/protocol setup and logging traps that can mislead assistant
    writes.
  - Assistant runtime/automation help and explicit route precedence where the
    behavior is confirmed.
  - Generated example copy-safety for representative commands.
  - Focused tests for each changed behavior or help contract.
- Out of scope:
  - Rebuilding the CLI framework or replacing incur rendering.
  - Broad assistant prompt rewrites beyond short routing/guidance corrections.
  - Hosted runtime topology, device-sync architecture, or assistant daemon
    lifecycle redesign.
  - Fixing every weak output schema. Only fix schemas that directly block the
    command UX changes in this plan.

## Constraints

- Preserve existing package ownership:
  - CLI command definitions stay in `packages/cli`.
  - Command-shaped orchestration and option validation stay in
    `packages/vault-usecases`.
  - Canonical mutations stay in `packages/core`.
  - Read-side ambiguity fixes stay in `packages/query` when the ambiguity is a
    query lookup issue.
  - Assistant-facing prompt/contract changes stay in `packages/assistant-engine`
    or `packages/assistant-cli` as appropriate.
- Keep privacy-safe errors:
  - Include option name, repeated item index, and field path.
  - Do not echo raw user payloads, supplement labels, notes, file paths, or
    direct identifiers in validation errors unless they are already canonical
    ids meant for the command surface.
- Prefer small hard failures over silent surprising writes.
- Do not add compatibility aliases for every mistaken form. Fix guidance and
  validation first.

## Workstreams

### 1. Copy-safe generated examples

Problem:
- Several help and `--llms-full` examples render multi-word positional text
  without shell quotes or render camelCase flags while the visible CLI help uses
  kebab-case flags.
- Verified example: `intervention add` renders `vault-cli intervention add 20
  min sauna after lifting.`, which passes only `20` as the text and fails type
  inference.

Tasks:
1. Add a focused test that renders examples for representative commands and
   asserts:
   - multi-word positional args are shell-quoted;
   - repeatable arrays render as repeated flags, not comma-joined values;
   - boolean flags render as bare kebab-case flags when true;
   - option names use canonical CLI kebab-case in shell examples.
2. Fix example data or renderer behavior for at least:
   - `intervention add`
   - `automation save`
   - `assistant run` or another assistant command with booleans
   - `search` or `capture` repeatable examples
   - one recipe or meal example with multi-word values
3. Run the focused CLI example tests plus `pnpm test:diff` for touched CLI
   files.

Preferred implementation:
- Start by fixing example metadata where only a few examples are wrong.
- If the same renderer bug affects many commands, fix the renderer once and
  keep command-specific changes minimal.

### 2. Repeated input validation and set/clear conflicts

Problem:
- Some repeated structured inputs report generic validation failures.
- Some edit commands allow setting and clearing the same field in one call,
  where clear can silently win.

Tasks:
1. Improve `supplement save --ingredient` validation:
   - report `--ingredient #N` and the safe field path;
   - special-case unit-space failures with guidance to use compact units like
     `mcg` and put qualifiers like `DFE` in `note`;
   - keep raw JSON payloads out of the error envelope.
2. Apply the same error-shaping helper to food/recipe payload validation where
   repeated item paths are currently collapsed.
3. Add a shared or owner-local guard that rejects same-field set/clear
   conflicts for edit commands.
4. Cover at least meal, food, and recipe set/clear conflicts with tests.

Preferred implementation:
- Add a small helper only if it removes repeated code across owners.
- Avoid widening public APIs for tests only.

### 3. Supplement and regimen semantics

Problem:
- `supplement stop` examples imply slug lookup, but the path may pass the raw
  value as a regimen id.
- `supplement compound show` may match labels/product titles broadly enough to
  return the wrong compound.
- `regimen save` is less clear than `supplement save` about update semantics.
- `regimen save --unit` lacks the `--dose` guard that `supplement save
  --dose-unit` has.

Tasks:
1. Verify `supplement stop <slug>` against a fixture.
   - If it fails or attaches to the wrong lookup path, resolve through the same
     supplement lookup path as `supplement show` before stopping.
2. Add an ambiguity test for `supplement compound show` using a multi-ingredient
   product.
   - Prefer returning an ambiguity error with candidate compounds.
   - If product-title matching is not needed, restrict lookup to compound name
     and lookup id.
3. Add `regimen save` validation: `--unit requires --dose`.
4. Mirror supplement update wording on regimen ingredient/relation guidance:
   omitted fields preserve, supplied repeated fields replace the saved list.
5. Add focused tests for regimen unit validation and update help text.

### 4. Food, meal, recipe, and capture routing clarity

Problem:
- Murph needs a simple rule for choosing `meal add`, `food save`,
  `recipe save`, and `capture`.
- Recipe ingredients and steps naturally contain commas, but some typed flags
  reject commas as if they were comma-delimited lists.
- Capture label lookup may resolve to the newest match when labels are reused.
- Some save/update paths may default or replace status/list fields in surprising
  ways.

Tasks:
1. Add a short assistant-facing rule:
   - `meal add` for consumed events;
   - `food save` for reusable products or remembered foods;
   - `recipe save` for reusable preparation instructions;
   - `capture` for raw evidence, usually alongside a structured record.
2. Let recipe ingredient and step text contain ordinary commas while retaining
   comma rejection for tags, ids, and link-like repeated fields.
3. Verify capture label lookup ambiguity.
   - If duplicate labels choose newest silently, change lookup to fail with
     candidate ids or require an explicit latest-style option.
4. Verify sparse `food save` / `recipe save` update behavior on archived or
   saved records.
   - If omitted status resets on update, preserve existing status and apply
     defaults only on create.
5. Add tests for comma-containing recipe text and capture label ambiguity if
   the behavior is confirmed.

### 5. Device and wearable command traps

Problem:
- `device provider list` can make `junction` look like a connect target, but
  `device connect junction` is not valid user-facing behavior.
- Hosted connect guidance can include Fitbit, while read-side `wearables
  --provider fitbit` may reject it.
- `device account list` help may hide the distinction between runtime provider
  and upstream source provider.

Tasks:
1. Change `device connect` arg/help to avoid saying every provider-list entry is
   a connect target.
2. Add explicit connect targets to provider-list output, or add a separate
   connect-target list surface if that is simpler.
3. Hide or label `junction` as plumbing in provider-list output and examples.
4. Align wearable provider filters with public upstream sources where query
   projections support them.
   - If Fitbit read filters cannot be supported yet, document that Fitbit data
     should be read without `--provider fitbit` until the read filter exists.
5. Fix `device account list --provider` and `--source-provider` help so the
   distinction appears in `--help` and `--llms-full`.
6. Add tests for `device connect junction` guidance and account-list option
   descriptions.

### 6. Experiment and protocol assistant traps

Problem:
- Some experiment/protocol options are advanced enough to produce misleading
  records if Murph uses them casually.
- Session logging has both local experiment day and occurrence timestamp fields.
- Private protocol commands can be mistaken for public Health Commons lookup.

Tasks:
1. Verify whether `experiment start` can persist mismatched Health Commons
   `pageRevisionId` / `runSpecRevisionId`.
   - If yes, reject mismatched overrides or remove those overrides from the
     assistant-facing surface.
2. Clarify public/custom fallback:
   - hide internal `publicProtocol` from assistant-facing schemas if practical,
     or expose a clear `noPublicProtocol` option;
   - make help explicitly teach `--custom --no-public-protocol` for custom
     fallback.
3. Clarify `experiment session log` date behavior:
   - describe `--date` as the local/scheduled experiment day;
   - describe `--occurred-at` as the actual timestamp;
   - add an after-midnight example;
   - reject or warn when both are present and disagree in a way that changes the
     local day.
4. Improve private `protocol show` not-found messaging:
   - state that `protocol` is for private adaptations;
   - suggest `commons protocol show` or `commons protocol explore` for public
     Health Commons protocols.
5. Add focused tests for the confirmed behaviors.

### 7. Assistant runtime and automation UX

Problem:
- Murph is told to inspect some runtime facts, but some read-only commands may
  be absent from the assistant-facing CLI contract.
- Delivery route precedence may be surprising if saved self-targets override
  explicit flags.
- `automation save` appears patch-like but may behave like a full rewrite.
- Automation execution depends on `assistant run`, but that dependency is easy
  to miss.

Tasks:
1. Verify the assistant CLI contract exposure for safe read-only commands:
   - `assistant self-target list/show`
   - `assistant status`
   - `assistant doctor`
   - model/config inspection if already safe
2. If missing, expose read-only inspection commands while keeping recursive or
   send-capable commands hidden.
3. Verify delivery route precedence.
   - Prefer explicit flags over saved self-target defaults.
   - If the current behavior is intentionally saved-target-first, document the
     exact precedence in help and tests.
4. Verify `automation save` update semantics.
   - If it is a full rewrite, either make that explicit in help or preserve
     omitted existing fields on update.
   - Avoid automatic route retargeting on update unless the route flags are
     explicitly supplied.
5. Add help text explaining that saved automations execute while
   `assistant run` is active.
6. Add focused tests for command exposure, route precedence, and automation
   update semantics.

## Decisions

- Skip the broad compact discovery-manifest fix for now.
- Treat nested subagent reports as leads, not proof. Every behavior-changing
  fix needs a local focused test or direct command reproduction first.
- Prioritize issues that can cause silent wrong writes over issues that only
  make help text less polished.
- Prefer fail-fast ambiguity errors over guessing when multiple records or
  meanings match.

## Proposed implementation order

1. Fix copy-safe example rendering and add regression tests.
2. Fix repeated input validation paths and set/clear conflict rejection.
3. Fix supplement/regimen sharp edges.
4. Fix device/wearable connect-target guidance.
5. Fix food/recipe/capture routing and ambiguity.
6. Verify and fix experiment/protocol issues.
7. Verify and fix assistant runtime/automation issues.

## Verification plan

- For each workstream:
  - Add focused tests for the exact confirmed behavior.
  - Run `pnpm test:diff <touched paths>`.
  - Run `pnpm typecheck` before handoff.
- For CLI help/schema/example changes:
  - Run targeted `--help`, `--llms-full`, and `--schema --format json`
    commands for the touched commands.
  - Add tests that inspect generated help/LLM text where the UX contract
    matters.
- For mutation semantics:
  - Use temp-vault integration tests that prove the persisted record state.
  - Read back the record through the public show/list surface.
- For assistant runtime or device work:
  - Avoid live provider sends/OAuth in tests.
  - Use existing mocks/fixtures and command schemas.

## Completion reviews

- Required:
  - `coverage-write` after focused coverage-bearing checks for changed package
    owners.
  - `task-finish-review` before final handoff.
- Add `security-privacy-review` for any changes that expose runtime status,
  self-targets, delivery routing, provider identities, or device account
  surfaces.
- Add `deep-review` only if a fix crosses owner boundaries or changes
  persisted-state semantics beyond the narrow command behavior.

## Open questions

- Should `supplement compound show` support product-title lookup at all, or only
  canonical compound names and lookup ids?
- Should capture labels be unique by design, or should duplicate labels be
  allowed but require explicit disambiguation?
- Should Fitbit be a first-class wearable read filter now, or should current
  hosted guidance avoid provider-filtered Fitbit reads until query projection
  support is complete?
- Are experiment protocol revision overrides intended for any assistant path, or
  are they maintainer-only escape hatches that should be hidden?
- Should `automation save` become sparse-update semantics, or should it remain
  full-rewrite with stronger help text?

## Working set

- Likely files:
  - `packages/cli/src/commands/**`
  - `packages/cli/test/**`
  - `packages/vault-usecases/src/usecases/**`
  - `packages/vault-usecases/test/**`
  - `packages/query/src/health/**`
  - `packages/query/test/**`
  - `packages/assistant-engine/src/assistant/**`
  - `packages/assistant-engine/test/**`
  - `packages/assistant-cli/src/**`
  - `packages/assistant-cli/test/**`
  - `docs/contracts/03-command-surface.md` if command contracts materially
    change
