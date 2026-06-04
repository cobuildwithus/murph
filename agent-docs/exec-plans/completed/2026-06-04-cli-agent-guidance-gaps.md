# CLI Agent Guidance Gaps

## Goal

Close the highest-risk CLI example, scaffold, and validation gaps that can cause agents to guess nested payload field names or compact option grammars incorrectly.

Success criteria:

- Branchy typed commands show representative examples for their accepted shapes.
- Import/scaffold commands expose the important nested fields agents are likely to miss.
- Compact mini-language parsers reject unsupported fields with useful messages where the parser currently accepts silent junk.
- Focused tests prove the added guidance and targeted diagnostics.

## Scope

In scope:

- `scheduled-log save` branch examples and compact workout-field validation.
- Workout add/edit/format examples and compact grammar diagnostics.
- Measurement grouped qualifier/note examples.
- Goal/regimen/genetics scaffold examples for nested targets, ingredients, and relation links.
- Protocol, recipe, and samples import/example gaps.
- Lightweight guard coverage for scaffold/help/LLM metadata where the command already has examples.

Out of scope:

- A new schema-generation framework.
- Accepting additional aliases unless a parser already intentionally supports them.
- Reworking command topology or replacing import-json.
- Any assistant-engine prompt work already active in a separate lane.

## Worker Split

1. Scheduled-log typed branch examples and validation.
2. Workout add/edit/format examples and validation.
3. Measurement grouped qualifier/note examples.
4. Health entity scaffold templates for goal/regimen/genetics relation and nested payload branches.
5. Protocol, recipe, and samples examples/scaffolds.
6. Metadata/test safeguards for scaffold/help/LLM visibility.

## Risks

- Example churn can become noisy. Keep each addition to one high-signal branch example.
- Parser changes must be diagnostic-only unless they correct existing silent acceptance of unsupported keys.
- Some generated metadata may not support examples; prefer tests around the existing discoverability surfaces before adding abstractions.

## Verification

Completed:

- `pnpm --dir packages/cli typecheck` passed after implementation and after the coverage-write test additions.
- Focused CLI Vitest passed after implementation and after the coverage-write test additions:
  `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/scheduled-log-save-typed-parity.test.ts packages/cli/test/workout-add-typed-parity.test.ts packages/cli/test/workout-format-save-typed-parity.test.ts packages/cli/test/measurement-add-typed-parity.test.ts packages/cli/test/health-descriptors.test.ts packages/cli/test/cli-expansion-provider-event-samples.test.ts packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts packages/cli/test/cli-expansion-discoverability.test.ts packages/cli/test/incur-smoke.test.ts`.
- `pnpm --dir packages/contracts test` passed after implementation and after the coverage-write test additions.
- `pnpm typecheck` passed after the coverage-write test additions.
- `git diff --check` passed for scoped tracked files; `git diff --no-index --check` passed for new scoped files.
- `bash scripts/workspace-verify.sh test:diff <scoped task files>` passed through CLI targeted verification but failed in `packages/assistant-engine/test/codex-authority-hard-cut.test.ts` because unrelated active hosted-runtime work still contains `DEFAULT_HOSTED_CODEX_MODEL`. This is outside the CLI/contracts diff.

Audits:

- `simplify` found one accepted parser-helper duplication issue and one overbroad discoverability-test issue; both were fixed. It also flagged low-risk duplicated test helpers that were left in place to avoid broader test-helper churn.
- Required `coverage-write` added two test-only no-mutation proofs for unsupported compact keys in `workout edit` and `scheduled-log save`.
- Required `task-finish-review` reported no findings.
Status: completed
Updated: 2026-06-04
Completed: 2026-06-04
