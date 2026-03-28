Run the required completion-workflow `simplify` audit for the current greenfield compatibility cleanup.

Preflight:
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` first and honor it.
- Work in the current shared worktree without reverting unrelated edits.

Scope:
- Inspect the current diff and directly affected call paths.
- Focus especially on:
  - `packages/cli/src/assistant/outbox.ts`
  - `packages/cli/src/assistant/store/persistence.ts`
  - `packages/cli/src/assistant/cron.ts`
  - `packages/core/src/domains/experiments.ts`
  - `packages/core/src/public-mutations.ts`
  - `packages/core/src/storage-spine.ts`
  - `packages/core/src/index.ts`
  - `packages/core/src/family/types.ts`
  - `packages/core/src/family/api.ts`
  - `packages/core/src/genetics/types.ts`
  - `packages/core/src/genetics/api.ts`
  - `packages/core/src/history/types.ts`
  - `packages/core/src/history/api.ts`
  - `packages/importers/src/shared.ts`
  - `packages/importers/src/core-port.ts`
  - `packages/importers/src/meal-importer.ts`
  - `packages/importers/src/document-importer.ts`
  - `packages/importers/src/csv-sample-importer.ts`
  - `packages/importers/src/assessment/import-assessment-response.ts`
  - `packages/importers/src/device-providers/import-device-provider-snapshot.ts`
  - `packages/contracts/src/health-entities.ts`
  - `packages/query/src/health/registries.ts`
- Check the related tests in:
  - `apps/web/test/hosted-execution-outbox.test.ts`
  - `packages/cli/test/assistant-observability.test.ts`
  - `packages/cli/test/assistant-state.test.ts`
  - `packages/cli/test/assistant-cron.test.ts`
  - `packages/core/test/core.test.ts`
  - `packages/core/test/canonical-mutations-boundary.test.ts`
  - `packages/core/test/health-history-family.test.ts`
  - `packages/importers/test/importers.test.ts`
  - `packages/importers/test/input-validation.test.ts`
  - `packages/importers/test/device-providers.test.ts`
  - `packages/query/test/query.test.ts`

Goal:
- Simplify and harden the modified code without changing externally visible behavior.
- Delete dead code, stale branches, no-op abstractions, or unnecessary compatibility scaffolding if any remain.

Output:
- Return copy/paste-ready prompts per `agent-docs/prompts/simplify.md`.
- If there are no actionable issues, say so explicitly.
