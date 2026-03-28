Read `agent-docs/prompts/simplify.md` and follow it exactly.

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
  - the batch keeps the six requested refactors local to their existing package boundaries
  - shared logic only moved when reuse was immediate: hosted webhook receipts into one helper module, canonical write-guard parsing into core, and canonical collector strategy cleanup inside `packages/query`
  - no new cross-package abstraction layer was introduced beyond re-exporting the write-batch helpers already owned by core
- Invariants that must still hold:
  - hosted onboarding webhook receipt payload shape, duplicate semantics, and response contracts are unchanged
  - canonical write guard remains strict and preserves the same error codes/messages and protected-file set
  - device import deterministic IDs, import ordering, manifest contents, and raw-artifact fallback semantics are unchanged
  - history event defaults and canonical read/write behavior are unchanged
  - hosted runtime commit/replay/finalize ordering is unchanged
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
  - `pnpm --dir apps/cloudflare typecheck` FAIL in untouched `apps/cloudflare/src/user-runner/runner-bundle-sync.ts`
  - `pnpm typecheck` FAIL for the same untouched Cloudflare file
  - `pnpm test` still fails the agent-docs drift wrapper in the dirty tree
  - `pnpm test:coverage` still fails in untouched `apps/web/test/hosted-share-service.test.ts`
- Direct scenario proof already run:
  - history path: appended/read `exposure` preserved `exposureType: "unspecified"` via direct `node --input-type=module` proof
- Current worktree context:
  - shared dirty tree with unrelated active rows; do not revert or widen
  - review only the files above plus directly affected call paths

Return copy/paste-ready prompts only. If no actionable simplifications remain, say so explicitly.
