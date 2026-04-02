# Hosted Assistant Greenfield Cleanup

## Goal

Remove hosted-assistant compatibility behavior that only existed for pre-existing saved config now that the repo has no deployed workspaces to migrate.

## Why

- The current hosted-assistant seam still carries legacy migration/backfill code and status variants that complicate the operator-config/runtime path.
- Durable docs still describe older-workspace backfill and one stale assistant-defaults compatibility claim that no longer match the intended hard cut.

## Scope

- `packages/assistant-core/src/{hosted-assistant-config.ts,operator-config.ts}`
- `packages/assistant-runtime/src/hosted-runtime/{models.ts,maintenance.ts,summary.ts}`
- focused hosted/runtime tests under `packages/assistant-runtime/test/**`
- durable docs: `ARCHITECTURE.md`, `apps/cloudflare/README.md`, `agent-docs/index.md`

## Non-Goals

- No broader assistant architecture refactor.
- No cleanup of unrelated repo-wide legacy surfaces outside the hosted-assistant seam.

## Plan

1. Remove legacy hosted backfill/migration behavior from operator-config and hosted assistant bootstrap.
2. Delete legacy-only runtime status variants and focused tests that prove old-workspace adoption.
3. Update durable docs so they describe only the hard-cut hosted-assistant source of truth.
4. Re-run focused verification and then finish with a scoped commit.

## Result

- Removed the hosted-assistant legacy adoption path from `ensureHostedAssistantOperatorDefaults`; missing hosted config now stays missing unless the worker env or an explicit hosted profile seeds it.
- Dropped operator-config support for legacy assistant `provider/defaultsByProvider` migration while keeping tolerant reads for malformed current-shape assistant config.
- Removed the runtime-only `legacy-defaults` status branch and the focused tests that only proved older-workspace hosted backfill.
- Updated durable architecture/docs wording so the hosted-assistant seam is described as a strict hard cut with one persisted source of truth.
- While re-running repo verification, fixed the current CLI strict-nullability test error in `packages/cli/test/assistant-observability.test.ts` so `pnpm typecheck` is green again.

## Verification Outcome

- Passed: `pnpm exec tsc -p packages/assistant-core/tsconfig.json --noEmit`
- Passed: `pnpm exec tsc -p packages/assistant-runtime/tsconfig.json --noEmit`
- Passed: `pnpm vitest run packages/assistant-runtime/test/hosted-assistant-bootstrap.test.ts packages/assistant-runtime/test/assistant-core-boundary.test.ts --maxWorkers=1 --coverage.enabled=false`
- Passed: `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/node-runner.test.ts`
- Passed: `pnpm typecheck`
- Passed: `git diff --check`
- Fails unrelated: `pnpm test` still trips the existing `apps/web` smoke lock (`apps/web/scripts/dev-smoke.ts` reports an active Next dev process lock for pid `84824` / port `62396`).
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
