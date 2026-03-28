# 2026-03-28 Green Checks Integration

## Goal

- Land the scoped assistant, Telegram, parser-build, and smoke-fixture fixes needed to restore a fully green repo verification run on the current worktree without reverting unrelated active lanes.

## Scope

- `agent-docs/exec-plans/active/{2026-03-28-green-checks-integration.md,COORDINATION_LEDGER.md}`
- `packages/cli/src/{assistant-cli-contracts.ts,assistant/service.ts,commands/assistant.ts,usecases/{food.ts,recipe.ts}}`
- `packages/cli/test/{cli-test-helpers.ts,inbox-service-boundaries.test.ts,incur-smoke.test.ts}`
- `packages/runtime-state/src/hosted-bundles.ts`
- `packages/hosted-execution/src/parsers.ts`
- `packages/hosted-execution/test/hosted-execution.test.ts`
- `packages/inboxd/src/connectors/telegram/normalize.ts`
- `packages/inboxd/test/telegram-connector.test.ts`
- `apps/web/src/lib/hosted-onboarding/{telegram.ts,webhook-receipt-dispatch.ts}`
- `apps/web/test/{hosted-execution-hydration.test.ts,hosted-onboarding-telegram-dispatch.test.ts}`
- `scripts/workspace-verify.sh`
- `e2e/smoke/scenarios/{assistant-cron-add.json,assistant-cron-preset-install.json,assistant-state-*.json,document-edit.json,event-edit.json,intervention-edit.json,meal-edit.json,workout-edit.json,workout-format-*.json}`

## Constraints

- Preserve unrelated dirty edits already present in the tree.
- Keep the inline build-cleanup removal clean and scriptable; do not reintroduce the `node -e` retry one-liner.
- Prefer focused regression coverage over production-behavior expansion.

## Plan

1. Finish the narrow assistant session/schema and Telegram parity fixes already in flight.
2. Close the highest-impact coverage gaps from the mandatory coverage audit.
3. Re-run `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` until all three are green.
4. Attempt the required `task-finish-review` spawned audit and record any environment limitation if the result is not retrievable.
5. Commit only the scoped files for this integration lane.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

- `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` all pass on the current worktree.
- Mandatory `simplify` and `test-coverage-audit` passes were completed earlier in the lane and their follow-up tests are included here.
- A `task-finish-review` spawned audit was launched after the final green verification, but this environment did not surface a retrievable result artifact back to the parent agent.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
