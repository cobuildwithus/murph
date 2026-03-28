# 2026-03-28 Hosted Webhook Dispatch Prisma Boundary

## Goal

Tighten the hosted webhook dispatch enqueue boundary so the type and field naming match the real ownership model: accept either a root Prisma client that can open a transaction or an existing transaction client that should be reused, while preserving the current atomic enqueue-plus-receipt-update behavior.

## Scope

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `apps/web/src/lib/hosted-onboarding/webhook-receipt-types.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-transport.ts`
- Focused hosted onboarding webhook dispatch/idempotency tests under `apps/web/test/**`

## Constraints

- Do not change the atomicity guarantee for enqueueing the execution outbox row plus updating the webhook receipt payload.
- If a root Prisma client is passed, keep both writes inside one transaction.
- If an existing transaction client is passed, reuse it and do not open a nested transaction.
- Keep the change narrow; do not broaden the abstraction across unrelated hosted onboarding code unless the current code forces it.
- Preserve adjacent dirty-tree edits.

## Planned Changes

1. Introduce an explicit hosted-webhook persistence client union for the enqueue boundary.
2. Rename the enqueue input field to reflect that it may be either a root Prisma client or an existing transaction.
3. Extract the shared enqueue-plus-receipt-update body into one helper and route both ownership branches through it.
4. Remove the unsafe `unknown as Prisma.TransactionClient` cast if the clarified type allows it.
5. Update focused tests to use the clarified semantics without changing behavior expectations.

## Verification

- Focused `apps/web` webhook dispatch/idempotency tests during development
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Required completion-workflow audit passes via spawned subagents after implementation

## Current Status

- Prompt validated against the live tree: the target logic now lives in `apps/web/src/lib/hosted-onboarding/webhook-transport.ts`, while the enqueue input type is re-exported through `webhook-receipts.ts`.
- Implemented the narrow boundary cleanup in `webhook-receipt-types.ts` and `webhook-transport.ts`: the enqueue seam now uses `HostedWebhookReceiptPersistenceClient`, the field is renamed to `prismaOrTransaction`, the shared enqueue-plus-receipt-update body is factored into one helper, and the unsafe `unknown as Prisma.TransactionClient` cast is gone.
- Focused verification is green:
  - `pnpm --dir apps/web exec tsc --noEmit`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
- Repo-wide verification status:
  - `pnpm typecheck` is currently red for unrelated existing `packages/contracts/scripts/verify.ts` missing exports from `@murph/contracts`.
  - `pnpm test` is currently red for an unrelated workspace cleanup failure while removing `packages/query/dist` (`ENOTEMPTY`).
  - `pnpm test:coverage` continues into unrelated workspace failures outside this lane, including previously observed `packages/core` / `packages/runtime-state` build-type errors and Cloudflare hosted-user-env warnings.
- Mandatory audit passes completed through local `codex exec` subprocesses:
  - `simplify`: tighten the normalized inner helper to accept `Prisma.TransactionClient` only.
  - `test-coverage-audit`: add direct root-client transaction proof at the public Linq webhook boundary, including a distinct transaction callback client.
  - `task-finish-review`: no actionable findings after the coverage follow-up.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
