# Blood Test Text Result UX

## Goal

Make blood-test JSON scaffolds and validation errors teach the canonical `textValue` field for non-numeric lab results.

Success criteria:

- `blood-test scaffold` includes a text-result example using `textValue`.
- `valueText` remains invalid but produces a targeted "Did you mean textValue?" diagnostic.
- `blood-test save --result` examples also show a text-result shape.
- Focused tests cover scaffold output and the typo diagnostic.

## Scope

In scope:

- `packages/contracts/src/health-entities.ts`
- `packages/core/src/history/api.ts`
- Focused CLI/core tests and generated CLI discovery artifacts if needed

Out of scope:

- Accepting `valueText` as an alias
- New payload schema systems or typed mini-languages for blood-test results
- Broader assistant prompt changes

## Plan

1. Update the canonical blood-test scaffold template with one numeric result and one text result.
2. Add a narrow core diagnostic when a result object contains `valueText`.
3. Add/update focused tests for scaffold output, import-json typo handling, and save examples.
4. Run targeted verification for the touched owners, then complete required audits and commit.

## Risks

- Adding an alias would create long-term contract ambiguity, so this plan intentionally keeps the canonical field singular.
- The scaffold is reused by descriptor-driven CLI surfaces, so tests should assert the emitted scaffold shape directly.

## Verification

- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage --project cli-health-tail packages/cli/test/health-blood-test-save.test.ts` passed.
- `pnpm --dir packages/cli typecheck` passed.
- `pnpm --dir packages/core test -- health-history-family.test.ts` passed.
- `pnpm --dir packages/contracts test` passed.
- `pnpm typecheck` passed.
- `git diff --check -- packages/contracts/src/health-entities.ts packages/core/src/history/api.ts packages/core/test/health-history-family.test.ts packages/cli/src/commands/health-blood-test-save.ts packages/cli/test/health-blood-test-save.test.ts` passed.
- `bash scripts/workspace-verify.sh test:diff packages/contracts/src/health-entities.ts packages/core/src/history/api.ts packages/core/test/health-history-family.test.ts packages/cli/src/commands/health-blood-test-save.ts packages/cli/test/health-blood-test-save.test.ts` failed in unrelated `packages/assistant-engine` prompt tests from the separate active assistant-engine lane; the edited CLI/core/contracts checks above passed.

## Audits

- `coverage-write` added focused help-example coverage for numeric and text blood-test result examples.
- `task-finish-review` found that `blood-test save --result` needed the same `valueText` typo diagnostic as `import-json`; fixed with a parser pre-check and focused test.
Status: completed
Updated: 2026-06-04
Completed: 2026-06-04
