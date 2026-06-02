# Blood-test result JSON-only input

Status: completed
Created: 2026-06-02
Updated: 2026-06-02

## Goal

- Hard-cut `blood-test save --result` to one JSON object per analyte so
  semicolons and other punctuation inside structured result strings are normal
  JSON content rather than compact-parser delimiters.

## Success criteria

- `--result` help/schema advertises JSON objects only.
- Non-JSON compact strings are rejected with clear JSON-object guidance before
  any canonical event write.
- Existing blood-test save/revise behavior still works through repeatable JSON
  `--result` values.
- Generated CLI schema is refreshed.
- Focused CLI verification and required completion audits pass or have a
  clearly unrelated blocker.

## Scope

- In scope:
  - `packages/cli/src/commands/health-blood-test-save.ts`
  - Focused CLI tests for blood-test save and any direct callers that still use
    compact result strings.
  - Generated CLI config schema.
- Out of scope:
  - `--link` compact parsing.
  - `blood-test import-json`.
  - Vault/core blood-test record schemas.

## Constraints

- Technical constraints:
  - Keep `packages/cli` as a thin validator/orchestrator over core.
  - Do not add a second compatibility layer or migration shim for compact
    result strings.
  - Preserve repeatable `--result` for multiple analytes.
- Product/process constraints:
  - Prefer the simplest durable assistant UX over backward compatibility for the
    custom compact result DSL.
  - Preserve unrelated dirty work and ledger rows.

## Risks and mitigations

1. Risk: Existing compact-result scripts break after the hard cut.
   Mitigation: Return a direct error that names the JSON-object requirement and
   keep `blood-test import-json` for full-payload imports.
2. Risk: Invalid JSON errors leak health text.
   Mitigation: Keep syntax errors generic and schema errors behind the existing
   sanitized CLI error bridge.

## Tasks

1. Remove compact result parsing from `blood-test save`.
2. Update command descriptions, examples, and generated config schema.
3. Convert existing focused tests to JSON result values.
4. Add a no-write rejection test for old compact result syntax.
5. Run focused verification, audits, and finish the plan with a scoped commit.

## Decisions

- `--result` remains repeatable; each value must be exactly one JSON object.
- JSON arrays stay rejected with repeat/import-json guidance.
- Compact `--link` remains unchanged because it is a separate, much smaller
  link grammar and not the source of this blood-test result issue.

## Verification

- `pnpm --dir packages/cli gen:config-schema` passed and refreshed
  `packages/cli/config.schema.json`.
- `pnpm --dir packages/cli test -- health-blood-test-save.test.ts` passed
  before the coverage worker added one extra no-write/no-echo test: 98 files,
  855 tests.
- `bash scripts/workspace-verify.sh test:diff packages/cli/src/commands/health-blood-test-save.ts packages/cli/test/health-blood-test-save.test.ts packages/cli/test/murph-age-command.test.ts packages/cli/config.schema.json packages/cli/src/incur.generated.ts`
  passed before the coverage worker added one extra test: CLI typecheck,
  package shape, generated catalog, 22 files, 363 tests.
- Coverage worker added a schema-invalid JSON object no-write/no-echo test.
- `pnpm exec vitest run --config vitest.workspace.ts --project cli-health-tail --no-coverage -- health-blood-test-save.test.ts`
  from `packages/cli` passed after the coverage-worker addition: 9 files,
  58 tests.
- Post-coverage reruns of broader checks are blocked by unrelated dirty work:
  - `pnpm --dir packages/cli test -- health-blood-test-save.test.ts` failed
    before completion on unrelated
    `packages/assistant-engine/src/assistant/system-prompt.ts`.
  - Scoped `test:diff` failed in unrelated inbox attachment tests because
    concurrent dirty work removed `inbox attachment decode/parse/reparse` while
    existing tests still expect those commands.
  - Root `pnpm typecheck` failed in unrelated
    `scripts/hosted-local-e2e.test.ts` type errors.
- `git diff --check` on touched files passed after coverage and generated
  overlap cleanup.
- Touched-file identifier/secret scan passed.
- Required `security-privacy-review` passed with no findings.
- Required `coverage-write` added the schema-invalid JSON object proof.
Completed: 2026-06-02
