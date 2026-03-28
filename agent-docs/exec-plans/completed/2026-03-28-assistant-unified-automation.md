# Assistant Unified Automation

## Goal

Replace the split inbox-routing and auto-reply top-level scan shape with one unified assistant automation decision pass that preserves separate routing/reply cursors while reasoning over each eligible capture only once per scan.

## Scope

- `packages/cli/src/assistant/automation/**`
- `packages/cli/src/{assistant-runtime.ts,assistant/automation.ts,run-terminal-logging.ts}`
- Focused assistant runtime tests and the matching architecture note

## Constraints

- Preserve existing routing and auto-reply behavior where outcomes are unchanged.
- Keep routing and reply progress persisted independently even though scanning becomes one merged pass.
- Prevent the unified pass from splitting the same capture across routing and reply scans when the reply window truncates.
- Preserve adjacent dirty-tree edits and avoid unrelated assistant/runtime churn outside this automation slice.

## Verification

- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Focused iteration checks: assistant runtime tests and package-local typecheck/build where useful
- Passed: `pnpm vitest run packages/cli/test/assistant-runtime.test.ts --coverage=false` (`91/91`)
- Failed outside this lane: `pnpm typecheck`
  - `packages/core/src/operations/canonical-write-lock.ts` importing missing `@murph/runtime-state` exports
- Failed outside this lane: `pnpm test`
  - current `packages/cli` build errors in `src/commands/meal.ts`, `src/query-runtime.ts`, `src/usecases/integrated-services.ts`, and `src/inbox-services/promotions.ts`
- Failed outside this lane: `pnpm test:coverage`
  - unrelated red tests in `packages/cli/test/runtime.test.ts`

## Notes

- This change is intentionally structural: one inbox automation loop, modularized routing/reply helpers, and unified scan accounting/copy.
- Repo completion workflow calls for delegated `simplify`, `test-coverage-audit`, and `task-finish-review` passes, but this session cannot spawn subagents without explicit user delegation.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
