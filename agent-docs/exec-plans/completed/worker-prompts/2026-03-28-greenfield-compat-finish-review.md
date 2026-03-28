Run the required completion-workflow `task-finish-review` audit for the current greenfield compatibility cleanup.

Preflight:
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` first and honor it.
- Work in the current shared worktree without reverting unrelated edits.

Scope:
- Review the current diff and directly affected call paths, especially:
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
- Review the related tests listed in the simplify prompt path for this task.

Goal:
- Look for regressions, incorrect assumptions, invariant breaks, hidden compatibility dependencies, and missing proof at the relevant public boundaries.

Output:
- Return copy/paste-ready prompts per `agent-docs/prompts/task-finish-review.md`.
- If there are no actionable issues, say so explicitly.
