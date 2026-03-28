Read `agent-docs/prompts/test-coverage-audit.md` and follow it exactly.

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
- Why this implementation fits:
  - coverage already exists at the highest stable boundaries for each lane: webhook service, canonical collector, history/core mutation APIs, assistant service, and Cloudflare node runner
  - the current review question is whether any meaningful gap remains after the worker-added regressions
- Invariants that must still hold:
  - all six refactors remain behavior-preserving
  - no production behavior changes in this pass unless absolutely required by a missing high-impact test and already implied by existing behavior
- Active plans:
  - `agent-docs/exec-plans/active/2026-03-27-six-refactor-worker-batch.md`
  - `agent-docs/exec-plans/active/2026-03-27-six-refactor-batch-integration.md`
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
  - wrapper failures still blocked by unrelated dirty-tree issues:
    - `pnpm typecheck` / `pnpm --dir apps/cloudflare typecheck` in untouched `apps/cloudflare/src/user-runner/runner-bundle-sync.ts`
    - `pnpm test:coverage` in untouched `apps/web/test/hosted-share-service.test.ts`
    - `pnpm test` in dirty agent-docs drift state
- Direct scenario proof already run:
  - history exposure default proof via direct `node --input-type=module` invocation
- Current worktree context:
  - shared dirty tree with unrelated active rows; do not revert or widen
  - review only the files above plus directly affected tests

Return copy/paste-ready prompts only. If no actionable missing-test work remains, say so explicitly.
