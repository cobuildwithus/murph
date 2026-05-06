# Experiment CLI Typed Surface

## Goal

Remove confusing experiment creation and JSON escape-hatch surfaces from the user/assistant CLI, and make typed Incur commands the only normal way to start, edit, log, and review experiments.

Success criteria:

- No user-facing `vault-cli experiment create`.
- No user-facing `vault-cli experiment apply-onboarding`.
- No user-facing `vault-cli experiment *-json` commands.
- New experiments are started through typed `experiment start` flags, not JSON plan files.
- Existing experiments are modified through first-class typed `experiment edit` flags.
- Assistant prompt guidance names only typed experiment commands.
- Progress diagnostics do not confuse missing setup/analysis fields with missing wearable data.
- Progress output separates setup readiness, analysis readiness, and wearable coverage into distinct fields or blocking reasons.

## Constraints And Assumptions

- Remove CLI commands only. Keep lower-level TypeScript/core helpers when `experiment start` still needs internal create/update primitives.
- Existing vault experiment records remain readable. This plan does not migrate or delete old records.
- Structured service payloads may still exist inside TypeScript APIs; the user-facing CLI should not require JSON files or stdin JSON for experiment workflows.
- `experiment edit` replaces the current `apply-onboarding` repair/enrichment role, but with a clear name and typed command contract.
- Normal assistant behavior should prefer typed commands over raw JSON payload composition.
- Preserve unrelated working-tree edits and existing active experiment metric-direction work.
- `experiment start` is the persistence step after setup is resolved. It is not the first response to a user saying they want to try a protocol.
- `experiment outcome write` stays if it remains a typed deterministic persistence command with no JSON input surface.
- Standalone `experiment plan --input` is removed. Typed dry-run validation belongs on `experiment start --dry-run`.

## Proposed Command Shape

### Start

`vault-cli experiment start <slug> [typed options...]`

Responsibilities:

- Create or reuse an experiment by slug.
- Capture protocol lineage when a protocol is supplied.
- Resolve Health Commons protocol defaults when possible.
- Hydrate run windows, adherence targets, logging fields, and analysis metrics from protocol/test-plan defaults unless explicit typed flags override them.
- Write `runPlan`, `analysisPlan`, `onboarding`, and `assistantSupport` in one operation.
- Support `--dry-run` as the typed replacement for the current JSON `experiment plan --input` validation flow.
- Fail with typed missing-field errors when required safety, logistics, windows, or measurement fields are absent.

Protocol-backed starts may omit `--title` and `--hypothesis` when `--from-protocol` can hydrate clear defaults. Custom starts must opt in with `--custom` and provide enough typed fields to avoid creating another incomplete active run. `experiment start` without either `--from-protocol` or `--custom` fails. The lower-level plan payload must also carry a `source.kind` discriminator so raw create/start paths cannot accidentally blur Health Commons protocol-backed runs with intentionally custom runs.

Assistant prompt examples should use the smallest normal form, then add only explicit user answers or overrides:

`vault-cli experiment start <slug> --from-protocol <key-or-route> --intervention-start <YYYY-MM-DD>`

Assistant-normal typed options:

- `--from-protocol <key-or-route>`
- `--custom`
- `--test-plan-id <id>`
- `--title <title>`
- `--hypothesis <text>`
- `--started-on <YYYY-MM-DD>`
- `--intervention-start <YYYY-MM-DD>`
- `--schedule-kind <dailyLocal|cron>`
- `--schedule-local-time <HH:MM>`
- `--schedule-cron <expr>`
- `--schedule-time-zone <zone>`
- `--dose <text>`
- `--sessions-per-week <n>`
- `--target-sessions <n>`
- `--minimum-useful-sessions <n>`
- `--session-field <id>`
- `--confounder-field <id>`
- `--stop-condition <text>`
- `--primary-biomarker-key <key>`
- `--secondary-biomarker-key <key>`
- `--desired-direction <increase|decrease|stabilize>`
- `--expected-direction <biomarker:key=increase|decrease|stabilize>`
- `--setup-answer <id=value>`
- `--context-note <text>`
- `--reminders-enabled <boolean>`
- `--missed-log-followup <policy>`
- `--weekly-digest-enabled <boolean>`
- `--dry-run`

Advanced override options:

- `--baseline-start <YYYY-MM-DD>`
- `--baseline-end <YYYY-MM-DD>`
- `--baseline-days <n>`
- `--intervention-days <n>`
- `--page-revision-id <sha256:...>`
- `--run-spec-revision-id <sha256:...>`
- `--safety-caution-level <level>`
- `--safety-disposition <disposition>`
- `--positive-question-id <id>`
- `--safety-note <text>`
- `--analysis-note <text>`

Do not expose `--schedule-json` or any `@file.json` / stdin JSON schedule path. Schedules are typed only: `--schedule-kind`, `--schedule-local-time` or `--schedule-cron`, and `--schedule-time-zone`.

### Edit

`vault-cli experiment edit <lookup> [typed options...]`

Responsibilities:

- Replace `experiment update`.
- Replace `experiment apply-onboarding`.
- Patch an existing experiment through typed fields only.
- Support the union of current scalar update flags and current typed onboarding-apply flags.
- Scalar fields include `--title`, `--hypothesis`, `--started-on`, `--status`, `--body`, and repeatable `--tag`.
- Structured fields include run-plan fields, analysis-plan fields, onboarding capture fields, and assistant-support fields.
- Remain explicit: by default it edits exactly the fields named by flags.
- Protocol/test-plan default hydration requires an explicit `--hydrate-protocol-defaults` flag.
- Hydration fills missing fields only. It must not overwrite user-authored values.
- Mixed scalar plus structured edits must validate/apply structured fields before scalar writes, so invalid protocol/window fields cannot partially persist a title/body/status repair.

Do not expose `--schedule-json` here either. Schedules are typed only.

### Logging

Keep typed commands:

- `vault-cli experiment session log <lookup> [typed session fields...]`
- `vault-cli experiment context log <lookup> [typed context fields...]`
- `vault-cli experiment checkpoint <lookup> [typed checkpoint fields...]`
- `vault-cli experiment stop <lookup> [typed stop fields...]`

Remove assistant/user-facing JSON variants:

- `experiment session log-json`
- `experiment context log-json`
- `experiment checkpoint-json`

### Reads And Outcome

Keep read commands:

- `experiment show`
- `experiment list`
- `experiment progress`
- `experiment followup due`
- `experiment outcome analyze`

For outcome persistence, prefer a typed command shape over a JSON write path. If current `outcome write` writes deterministic analysis without accepting JSON input, it can stay; otherwise convert or remove the JSON input surface.

## Implementation Steps

1. Inventory current experiment commands and tests.
   - Confirm every `experiment create`, `apply-onboarding`, `plan --input`, `start --input`, and `*-json` reference.
   - Include CLI registration, direct command manifest, generated Incur types, tracked config schema, CLI docs, LLM/tool manifest tests, stdin JSON tests, canonical JSON input tests, assistant prompts, OpenClaw skill guidance, and command-surface docs.
   - Specifically include `packages/cli/config.schema.json`, `packages/cli/README.md`, `packages/cli/test/stdin-input.test.ts`, `packages/cli/test/cli-typed-agent-inputs-schema.test.ts`, and `packages/cli/test/canonical-json-input.test.ts`.
   - Identify generated Incur files and schemas that must be regenerated.

2. Convert `experiment start` from JSON payload input to typed Incur options.
   - Support protocol/test-plan hydration from Health Commons.
   - Replace standalone `experiment plan --input` with `experiment start --dry-run`.
   - Keep internal service APIs structured, but build the structure from typed flags.
   - Remove `--schedule-json`; use only typed schedule flags.
   - Preserve exact protocol lineage in canonical frontmatter.
   - Cover the simple create path before the public `experiment create` command is removed.

3. Remove `experiment create` from CLI registration and command manifests.
   - Keep internal core create helper if still used by start.
   - Update tests/fixtures that used public `experiment create` so they use typed `experiment start` or internal test helpers instead.
   - Update command-surface docs and tests.

4. Replace `apply-onboarding` and `update` with `experiment edit`.
   - Reuse the existing typed option normalization where possible.
   - Move all clear structured patch behavior under the new command name.
   - Replace result metadata, audit labels, and error copy that still say `experiment apply-onboarding` or direct users to `experiment update`.
   - Add command-manifest and command-contract tests for `experiment edit`.

5. Remove experiment JSON CLI surfaces.
   - Remove `experiment plan --input`.
   - Remove `experiment start --input`.
   - Remove `checkpoint-json`, `session log-json`, and `context log-json`.
   - Remove remaining experiment `inputFileOptionSchema` and `scheduleJson` surfaces from user-facing experiment commands.
   - Update generated types, command manifests, assistant prompts, docs, and tests.

6. Fix progress diagnostics for legacy incomplete experiments.
   - Make this a contract/schema change, not only a wording change.
   - Add `setupReadiness`, `analysisReadiness`, or `blockingReasons` to progress output.
   - Use explicit reasons such as `missing_run_plan`, `missing_intervention_window`, `missing_analysis_plan`, `missing_primary_biomarker`, and `missing_metric_window`.
   - Missing `runPlan` should report setup/window incomplete.
   - Missing `analysisPlan.primaryBiomarkerKey` should report analysis incomplete.
   - Reserve `dataCoverage.status = no_wearable_data` for the true case where a primary metric and windows are resolved but wearable evidence is absent.
   - Update `packages/contracts` progress schemas and browser-replica consumers if any serialized status or result shape changes.

7. Update assistant prompt guidance.
   - New runs use typed `experiment start`.
   - Repairs/enrichment use typed `experiment edit`.
   - Logging uses typed logging commands.
   - Remove JSON plan and stdin JSON examples.
   - Update both `packages/assistant-engine/src/assistant/system-prompt.ts` and `packages/assistant-engine/src/assistant/active-experiment-context.ts`.
   - Make active experiment context remain navigation-only, and require progress interpretation to inspect setup/analysis readiness before saying wearable data is missing or linked.
   - Update `packages/openclaw-plugin/skills/murph/SKILL.md` if it exposes old experiment command guidance.

8. Verify.
   - Run `pnpm --dir packages/cli gen:config-schema`, then verify `packages/cli/src/incur.generated.ts` and `packages/cli/config.schema.json` changed consistently.
   - Run `pnpm typecheck`.
   - Run either truthful `pnpm test:diff <touched paths>` or `pnpm --dir packages/cli verify:coverage`, plus package coverage for touched non-CLI owners not covered by `test:diff`.
   - Run focused CLI, vault-usecases, contracts, query, and assistant-engine tests covering command shape, prompt guidance, start/edit behavior, and progress diagnostics.
   - Run a hard stale-surface check:
     `rg -n "experiment (create|apply-onboarding|update|plan)|checkpoint-json|log-json|scheduleJson|schedule-json" packages/cli packages/vault-usecases packages/query packages/contracts packages/assistant-engine docs/contracts packages/openclaw-plugin`
   - Document any allowed internal-only matches.

## Stress-Test Refinements

Three review agents stress-tested the plan and current patch. Folded refinements:

- Treat `--test-plan-id` as the public option name everywhere; do not document `--test-plan`.
- Implement `experiment edit --hydrate-protocol-defaults` as a first-class typed edit mode that fills missing fields only.
- Reserve `no_wearable_data` for complete setup plus a primary metric with zero wearable metric days; incomplete setup should report setup/analysis readiness blockers and `insufficient` coverage.
- Avoid misleading phase/day counters for incomplete setup by returning `phase: planned` and `dayInRun: null` until run windows are complete.
- Bump the progress schema version because readiness fields are now required.
- Add `commons get`, `commons protocol explore`, and `experiment followup due` to docs/manifest surfaces so assistants discover the same commands the CLI exposes.
- Update OpenClaw guidance to use `commons protocol` for public Health Commons discovery, reserve top-level `protocol` for private saved adaptations, and run deterministic `experiment followup due` before scheduled missed-log or weekly-digest checks.
- Lock the mixed-edit partial-write invariant with tests: an invalid structured edit combined with scalar flags must not persist scalar changes.

## Open Questions

- `experiment start --from-protocol` may choose the protocol's default onboarding `planDefaults.testPlanId`; callers can override with `--test-plan-id`.
- `experiment edit --hydrate-protocol-defaults` does not overwrite existing user-authored structured fields. Overwrites require explicit typed edit flags.
- Resolved 2026-05-07: protocol-free `experiment start` requires explicit `--custom`; starting with neither `--from-protocol` nor `--custom` is invalid.

## Working Set

- `packages/cli/src/commands/experiment.ts`
- `packages/cli/src/vault-cli-command-manifest.ts`
- `packages/cli/src/incur.generated.ts`
- `packages/cli/config.schema.json`
- `packages/cli/README.md`
- `packages/cli/test/stdin-input.test.ts`
- `packages/cli/test/cli-typed-agent-inputs-schema.test.ts`
- `packages/cli/test/canonical-json-input.test.ts`
- `packages/vault-usecases/src/usecases/experiment-journal-vault.ts`
- `packages/vault-usecases/src/usecases/types.ts`
- `packages/vault-usecases/src/usecases/integrated-services.ts`
- `packages/core/src/domains/experiments.ts`
- `packages/contracts/src/zod.ts`
- `packages/query/src/experiments.ts`
- `packages/query/src/browser-replica/experiments.ts`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/src/assistant/active-experiment-context.ts`
- `packages/openclaw-plugin/skills/murph/SKILL.md`
- `docs/contracts/03-command-surface.md`
- Focused tests under `packages/cli/test`, `packages/vault-usecases/test`, `packages/query/test`, `packages/contracts/test`, and `packages/assistant-engine/test`
