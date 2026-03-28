You are Codex Worker F3 operating in the current shared worktree. Do not create a commit.

Before any code changes:
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Add your own row as `Codex Worker F3` with this lane's files/symbols and mark it `in_progress`.
- Keep this patch to CLI usecase files plus `packages/cli/src/usecases/shared.ts`.

After changes:
- Run the narrowest relevant tests you touch.
- Remove your ledger row before finishing.
- Final response: summary, files changed, tests run, blockers.

Task:

Replace the remaining manual list-envelope construction in CLI usecases with the existing `asListEnvelope(...)` helper.

Target call sites:
- `packages/cli/src/usecases/document-meal-read.ts`
- `packages/cli/src/usecases/experiment-journal-vault.ts`
- `packages/cli/src/usecases/food.ts`
- `packages/cli/src/usecases/integrated-services.ts`
- `packages/cli/src/usecases/provider-event.ts`
- `packages/cli/src/usecases/recipe.ts`

Guardrails:
- Only replace the final envelope assembly.
- Preserve exact filter object shapes, including `null` vs `undefined`, empty arrays, and `limit`.
- Preserve `nextCursor: null` and `count: items.length`.
- Do not change CLI schemas/options/help text.

Regression anchors:
- `packages/cli/test/list-cursor-compat.test.ts`
- `packages/cli/test/cli-expansion-document-meal.test.ts`
- `packages/cli/test/cli-expansion-experiment-journal-vault.test.ts`
- `packages/cli/test/cli-expansion-provider-event-samples.test.ts`
- `packages/cli/test/health-tail.test.ts`

