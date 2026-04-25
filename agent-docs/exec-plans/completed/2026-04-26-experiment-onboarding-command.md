# Add discoverable experiment onboarding apply command

Status: completed
Created: 2026-04-26
Updated: 2026-04-26

## Goal

- Add an Incur-discoverable experiment onboarding command so assistants can apply protocol onboarding/run setup choices without guessing a hidden `experiment update --input -` JSON payload.

## Success criteria

- `vault-cli experiment` exposes a purpose-built command with typed options for schedule, dose, reminder/support fields, and protocol revision ids.
- The command delegates the mapping into the existing experiment usecase layer and writes only the canonical experiment frontmatter shape.
- Focused tests cover command discovery/schema and the accepted payload/mapping path.
- Required scoped verification and completion reviews run or any unrelated blockers are recorded.

## Scope

- In scope:
  - `packages/cli` experiment command surface and generated Incur metadata.
  - `packages/vault-usecases` experiment update/apply helper if needed for clean mapping ownership.
  - Assistant-facing command guidance that currently tells models to use hidden `experiment update --input -` payloads for richer runs.
  - Command-surface docs and scenario manifests required by repo command coverage.
  - Focused tests for CLI schema/discovery and usecase validation.
- Out of scope:
  - Changing Health Commons protocol onboarding content.
  - Changing the canonical experiment frontmatter schema unless a direct compatibility gap requires it.
  - Reworking hosted assistant runtime command execution.

## Constraints

- Technical constraints:
  - Use Incur typed options instead of another hidden stdin payload for assistant-discoverable setup fields.
  - Keep canonical writes on existing vault/core/usecase boundaries.
  - Preserve unrelated dirty work in the shared checkout.
- Product/process constraints:
  - Private experiment runs must remain explicitly user-confirmed; this command only applies already-confirmed setup details.
  - Reminder metadata stays neutral and opt-in.

## Risks and mitigations

1. Risk: Duplicating schema knowledge between CLI and usecase layers.
   Mitigation: Keep the CLI command thin and reuse a single mapping/update function where feasible.
2. Risk: Over-broad flags make the command another generic patch API.
   Mitigation: Limit the command to onboarding/run-support fields assistants are expected to set.
3. Risk: Overlap with active unrelated CLI work.
   Mitigation: Avoid currently dirty CLI entry/test files and keep this lane in experiment command/usecase tests.

## Tasks

1. Inspect existing experiment command, usecase update validation, tests, and generated Incur metadata.
2. Implement a purpose-built onboarding/apply command with schema-visible options and clean mapping.
3. Add or update focused tests for schema discovery and write behavior.
4. Run scoped verification plus required completion audits.
5. Close the plan and commit only this task's paths if safe.

## Decisions

- Prefer a dedicated `experiment apply-onboarding` command over expanding generic `experiment update` with many optional flags, so the richer path has a narrow product meaning.

## Verification

- Passed:
  - `pnpm typecheck` before later unrelated dirty-tree hosted/commons edits appeared.
  - `bash scripts/workspace-verify.sh test:diff <touched paths>` before later unrelated dirty-tree hosted/commons edits appeared.
  - `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts`
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-cli-policy-wrappers.test.ts test/model-behavior.test.ts`
  - `pnpm --dir packages/vault-usecases typecheck`
  - `pnpm --dir packages/assistant-engine typecheck`
  - `pnpm exec tsx e2e/smoke/verify-scenario-integrity.ts --coverage`
- Blocked after unrelated concurrent dirty-tree edits:
  - `pnpm --dir packages/cli typecheck` now fails in `packages/cli/src/commands/commons.ts` for missing `CommonsEntityType`.
  - `bash scripts/workspace-verify.sh test:diff <touched paths>` now fails in `packages/hosted-execution/src/parsers.ts` for missing `parseHostedExecutionOptionalTimeZone`.

## Outcome

- Added first-class `experiment apply-onboarding` with typed Incur-visible fields for protocol refs, run windows, logging, onboarding answers, safety, and assistant support.
- Changed `experiment update` to simple scalar/id-based fields and removed the hidden `--input` update command surface.
- Added assistant/OpenClaw guidance for `apply-onboarding` and removed the old rich-run `experiment update --input -` guidance.
- Added argv redaction for sensitive assistant-bound `experiment apply-onboarding` values.
- Generated Incur command metadata and updated smoke command-surface coverage.
Completed: 2026-04-26
