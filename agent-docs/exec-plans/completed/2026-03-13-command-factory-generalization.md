Goal (incl. success criteria):
- Replace the current one-off provider/event/document/meal/intake/experiment command builders with shared factory families rooted in `packages/cli/src/commands/health-command-factory.ts`.
- Replace mode-enum-driven health descriptor branching with explicit filter/result capability declarations where the factory layer needs to know what a noun supports.
- Preserve the existing CLI surface, option names, output shapes, and runtime behavior.

Constraints/Assumptions:
- Preserve adjacent edits already in flight in the overlapping CLI command/test files.
- Keep the top-level CLI registration surface unchanged unless a narrow import/export adjustment is required for the refactor.
- Avoid unrelated changes in inbox/export/vault wiring and avoid contract/doc churn unless the refactor truly requires it.

Key decisions:
- Add shared factory families for the command shapes that already exist: registry-doc, ledger-event, artifact-backed entity, and lifecycle.
- Use explicit filter/result capability declarations in descriptor/factory config instead of `CrudListMode`, `HealthResultMode`, and `HealthUpsertMode`.
- Reuse the current usecase/helper functions where possible so the refactor stays behavior-preserving.

State:
- completed

Done:
- Reviewed repo instructions, runtime/verification docs, completion workflow, and the active coordination ledger.
- Inspected the current health command factory, descriptor layer, manual command groups, and related tests/usecases.
- Migrated `document`, `meal`, and `intake` onto the shared artifact-backed entity factory while preserving their existing command names, option names, and helper/usecase call paths.
- Replaced health upsert-result branching in `packages/cli/src/commands/health-entity-command-registry.ts` with capability-driven schema selection.
- Replaced health core/query branching in `packages/cli/src/usecases/health-services.ts` with explicit capability checks for upsert inputs, upsert results, and list filters.
- Ran focused verification with `pnpm exec vitest run --no-coverage packages/cli/test/health-tail.test.ts packages/cli/test/list-cursor-compat.test.ts` and both suites passed.
- Ran required repo checks and recorded unrelated pre-existing failures:
- `pnpm typecheck` fails in `packages/cli/test/inbox-cli.test.ts` and `packages/cli/test/search-runtime.test.ts`.
- `pnpm test` and `pnpm test:coverage` fail in `packages/cli/scripts/verify-package-shape.ts` because `test/canonical-write-lock.test.ts` reaches into another package's `src` tree.
- `pnpm build` fails in untouched `packages/cli/src/index.ts` with an inferred `cli` type portability error.

Now:
- Close the execution plan, remove the active ledger row, and commit the scoped file set.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-03-13-command-factory-generalization.md`
- `packages/cli/src/commands/health-entity-command-registry.ts`
- `packages/cli/src/usecases/health-services.ts`
- `packages/cli/src/commands/document.ts`
- `packages/cli/src/commands/meal.ts`
- `packages/cli/src/commands/intake.ts`
- `packages/cli/test/health-tail.test.ts`
- `packages/cli/test/list-cursor-compat.test.ts`
- Commands: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
Status: completed
Updated: 2026-03-13
Completed: 2026-03-13
