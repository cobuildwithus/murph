## Goal

Replace the canonical hosted Linq `conversation.message` wake payload with a hosted-specific typed message payload instead of carrying a minimized webhook-shaped `linqEvent`.

## Scope

- `packages/hosted-execution/src/{contracts,builders,parsers}.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- Minimal downstream consumer updates needed to keep the hosted Linq runtime ingestion path truthful and type-safe
- Focused tests under `packages/{hosted-execution,assistant-runtime,inboxd}/test/**` and `apps/web/test/**`

## Constraints

- Treat this as greenfield cleanup: no deployed wake payload compatibility requirement.
- Preserve parity for hosted Linq dedupe identity, session/account lookup, reply threading, text/media handling, and attachment follow-up.
- Do not reintroduce provider-webhook-shaped objects into the canonical hosted wake contract.
- Preserve unrelated in-flight worktree edits.

## Verification

- Passed:
  - `pnpm --dir packages/hosted-execution typecheck`
  - `pnpm --dir packages/inboxd typecheck`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm --dir packages/hosted-execution exec vitest run test/hosted-execution-builders-hosted-email.test.ts test/hosted-execution-contract-guards.test.ts test/hosted-execution-parsers-coverage.test.ts test/hosted-wake-contracts.test.ts test/parsers.test.ts --config vitest.config.ts --coverage=false`
  - `pnpm --dir packages/inboxd exec vitest run test/linq-connector.test.ts --config vitest.config.ts --coverage=false`
  - `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-events.test.ts test/hosted-runtime-conversation-event.test.ts test/hosted-runtime-typing.test.ts test/hosted-runtime-runner.test.ts test/hosted-runtime-summary.test.ts test/hosted-runtime-context.test.ts test/hosted-runtime-execution.test.ts --config vitest.config.ts --coverage=false`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --project hosted-web-onboarding-integrations apps/web/test/hosted-onboarding-linq-dispatch.test.ts --coverage=false`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --project hosted-web-store-config apps/web/test/hosted-wake-queue.test.ts --coverage=false`
  - `pnpm test:smoke`
- Blocked or unrelated red:
  - Root `pnpm typecheck` remains blocked behind an unrelated long-running `apps/cloudflare verify` workspace lock.
  - `pnpm test:diff packages/hosted-execution packages/assistant-runtime packages/inboxd apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/hosted-wake-queue.test.ts` failed only for unrelated existing workspace issues in `apps/web/package.json`, `apps/cloudflare/src/user-runner/runner-state-store.ts`, and `packages/cli/test/release-script-coverage-audit.test.ts`.
- Direct proof:
  - Focused hosted Linq builder/parse/runtime ingestion tests stayed green after the contract cutover, including the hosted builder assertion that legacy `linqEvent` and `linqMessageId` fields no longer appear on the canonical wake payload.
  - `packages/inboxd/test/linq-connector.test.ts` now covers the hosted typed-path reply metadata plus metadata-only attachment fallback when a media download fails.
- Required audits:
  - `coverage-write` completed on `gpt-5.4-mini` with one narrow hosted builder assertion and no production-code changes.
  - `task-finish-review` completed with no findings; residual human-only check is an end-to-end hosted Linq `reply_to` plus media scenario once a suitable environment exists.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
