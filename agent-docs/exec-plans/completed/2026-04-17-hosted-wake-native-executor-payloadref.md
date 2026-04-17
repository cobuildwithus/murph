## Goal

Land the supplied hosted wake patch by reconciling direct native wake execution and payload-ref persistence updates onto current `apps/web` and `apps/cloudflare` head.

## Scope

- `apps/cloudflare/src/user-runner/runner-dispatch-processor.ts`
- `apps/cloudflare/src/user-runner/runner-queue-store.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/test/hosted-local-linq-*.test.ts`
- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/**`
- `apps/web/src/lib/hosted-execution/outbox.ts`
- `apps/web/src/lib/hosted-wake/dispatch.ts`
- `apps/web/src/lib/hosted-wake/payload.ts`
- `apps/web/src/lib/hosted-wake/store.ts`
- focused `apps/web/test/**`
- assistant inbox automation cursor plumbing under `packages/operator-config`, `packages/inboxd`, `packages/inbox-services`, and `packages/assistant-engine`

## Constraints

- Preserve unrelated hosted web and hosted runner work already landed on current head.
- Treat the supplied patch as intended behavior, not overwrite authority when context has moved.
- Keep trust-boundary, queue, and durability behavior aligned with current hosted execution docs.

## Verification

- `pnpm typecheck`
- truthful diff-aware or app-level verification for touched `apps/web` and `apps/cloudflare` slices
- direct proof for hosted wake payload persistence and native wake execution behavior
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/user-runner-hosted-wake.test.ts --no-coverage`
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/hosted-wake-payload.test.ts test/hosted-wake-store.test.ts --no-coverage`
- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-automation-runtime.test.ts test/assistant-automation-state.test.ts --no-coverage`
- `pnpm --dir packages/inboxd exec vitest run test/inboxd-runtime-kernel-coverage.test.ts --no-coverage`
- `pnpm --dir packages/inbox-services exec vitest run test/inbox-app-reads-runtime.test.ts --no-coverage`
- `env -u NODE_OPTIONS -u MURPH_DEV_CF_WRANGLER_LOG_LEVEL MURPH_DEV_SKIP_RUNNER_BUNDLE=1 pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts --no-coverage`
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
