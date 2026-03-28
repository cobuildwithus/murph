Read `agent-docs/prompts/task-finish-review.md` and follow it exactly.

Audit handoff packet:
- Change set under review:
  - `apps/web/src/lib/hosted-onboarding/{webhook-receipts.ts,webhook-service.ts}`
  - `apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
  - `packages/query/src/health/canonical-collector.ts`
  - `packages/query/test/health-tail.test.ts`
  - `packages/core/src/{history/api.ts,mutations.ts,index.ts,operations/{index.ts,write-batch.ts}}`
  - `packages/core/test/{core.test.ts,health-history-family.test.ts}`
  - `packages/cli/src/assistant/canonical-write-guard.ts`
  - `packages/assistant-runtime/src/hosted-runtime.ts`
  - `apps/cloudflare/src/node-runner.ts`
  - `apps/cloudflare/test/node-runner.test.ts`
  - `agent-docs/exec-plans/active/2026-03-27-six-refactor-batch-integration.md`
- Invariants:
  - behavior-preserving refactors only
  - hosted webhook receipt lifecycle/response contracts unchanged
  - canonical write guard still blocks unauthorized direct canonical edits and preserves existing error contracts
  - deterministic device import IDs and ordering unchanged
  - hosted runtime commit/replay/finalize ordering unchanged
- Verification already run:
  - `pnpm --dir packages/core typecheck` PASS
  - `pnpm --dir packages/query typecheck` PASS
  - `pnpm --dir packages/cli typecheck` PASS
  - `pnpm --dir packages/assistant-runtime typecheck` PASS
  - `pnpm --filter ./apps/web exec tsc -p tsconfig.json --pretty false --noEmit` PASS
  - `pnpm exec vitest run packages/core/test/health-history-family.test.ts packages/core/test/device-import.test.ts packages/core/test/core.test.ts --no-coverage --maxWorkers 1` PASS
  - `pnpm --dir packages/query test` PASS
  - `pnpm exec vitest run packages/cli/test/assistant-service.test.ts --no-coverage --maxWorkers 1` PASS
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts --no-coverage --maxWorkers 1` PASS
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/node-runner.test.ts --no-coverage --maxWorkers 1` PASS
  - repo wrappers still red for unrelated dirty-tree reasons:
    - `pnpm typecheck` / `pnpm --dir apps/cloudflare typecheck` in untouched `apps/cloudflare/src/user-runner/runner-bundle-sync.ts`
    - `pnpm test:coverage` in untouched `apps/web/test/hosted-share-service.test.ts`
    - `pnpm test` in dirty agent-docs drift state
- Direct scenario proof already run:
  - history exposure default proof via direct `node --input-type=module` invocation
- Current worktree context:
  - shared dirty tree with unrelated active rows; do not revert or widen
  - inspect all modified files plus directly affected call paths

Return findings only as copy/paste-ready prompts. If no actionable findings remain, say so explicitly and list residual risk areas briefly.
