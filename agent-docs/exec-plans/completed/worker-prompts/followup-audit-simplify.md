You are Codex Audit Worker FS operating in the current shared worktree. Do not create a commit.

Before any edits:
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Add a row as `Codex Audit Worker FS` only if you need to edit files; review-only is preferred.
- Preserve unrelated in-flight edits and do not revert anything.

Task:
- Run the simplify pass on the follow-up simplification batch only.
- Review scope:
  - `packages/core/src/canonical-mutations.ts`
  - `packages/core/src/domains/shared.ts`
  - `packages/core/src/bank/providers.ts`
  - `packages/cli/src/usecases/{shared.ts,document-meal-read.ts,experiment-journal-vault.ts,food.ts,integrated-services.ts,provider-event.ts,recipe.ts}`
  - `packages/importers/src/device-providers/{shared-normalization.ts,oura.ts,whoop.ts,garmin-helpers.ts,garmin.ts}`
  - `packages/core/test/health-bank.test.ts`

Current evidence:
- The five follow-up worker lanes all exited `0`.
- `canonical-mutations` focused tests passed.
- provider/domain helper focused tests passed.
- CLI list-envelope focused tests passed, but broader `packages/cli/test/runtime.test.ts` still failed on unrelated pre-existing cases outside this batch.
- importer device-provider focused tests and typecheck passed.
- protocol selector task correctly ended as report-only with characterization tests.

Instruction:
- Apply only clearly justified, behavior-preserving local simplifications.
- If the current implementation is already proportionate, say so explicitly and make no edits.
- Final response should follow `agent-docs/prompts/simplify.md`: either no actionable issues or copy/paste-ready prompts.

