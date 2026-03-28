You are Codex Audit Worker FT operating in the current shared worktree. Do not create a commit.

Before any edits:
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Add a row as `Codex Audit Worker FT` before any code/test edits.
- Preserve unrelated in-flight edits and do not revert anything.

Task:
- Run the test-coverage audit on the follow-up simplification batch only.
- Review scope:
  - `packages/core/src/canonical-mutations.ts`
  - `packages/core/src/domains/shared.ts`
  - `packages/core/src/bank/providers.ts`
  - `packages/core/test/{canonical-mutations-boundary.test.ts,core.test.ts,health-bank.test.ts}`
  - `packages/cli/src/usecases/{shared.ts,document-meal-read.ts,experiment-journal-vault.ts,food.ts,integrated-services.ts,provider-event.ts,recipe.ts}`
  - `packages/cli/test/{list-cursor-compat.test.ts,cli-expansion-document-meal.test.ts,cli-expansion-experiment-journal-vault.test.ts,cli-expansion-provider-event-samples.test.ts,health-tail.test.ts}`
  - `packages/importers/src/device-providers/{shared-normalization.ts,oura.ts,whoop.ts,garmin-helpers.ts,garmin.ts}`
  - `packages/importers/test/device-providers.test.ts`

Current evidence:
- `packages/core` focused tests passed for the canonical-mutations and provider/helper lanes.
- `packages/core/test/health-bank.test.ts` now includes protocol selector characterization tests.
- CLI list-envelope focused tests passed; broader `runtime.test.ts` failures were reported as unrelated pre-existing failures.
- importer focused tests and typecheck passed.

Instruction:
- Implement only the highest-impact missing tests you find for the changed behavior.
- If the current focused coverage is sufficient, say so explicitly and make no edits.
- Run the narrowest relevant verification command for any test edits.
- Final response should follow `agent-docs/prompts/test-coverage-audit.md`.

