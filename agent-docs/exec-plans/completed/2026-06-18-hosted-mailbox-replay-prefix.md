# Hosted Mailbox Replay Prefix Follow-Up

## Goal

Fix ReviewGPT round 11 high findings on PR 216:

- production hosted mailbox fetch must preserve replay-prefix availability when
  server `consumed_seq` is behind the runtime's imported watermark
- runtime replay import must restore consumed conversation rows that are missing
  from a stale local snapshot as non-replyable context, not silently discard them

## Constraints

- Keep the architecture simple: web owns mailbox rows and lane watermarks;
  runtime local import state remains the source of imported progress.
- Do not add new persisted state, schedulers, or compatibility shims.
- Keep changes scoped to the hosted mailbox resolver/importer and focused tests.

## Plan

1. Restore production dual-cursor fetch behavior for `consumedSeq < importedSeq`.
2. Let runtime import rows above local imported watermark even when they are at or
   below server consumed watermark, so conversation context is restored.
3. Replace brittle tests with production-shaped regression coverage.
4. Run focused assistant-runtime and hosted-web tests, typecheck, and diff tests.

## Working Set

- `apps/web/src/lib/hosted-mailbox/store.ts`
- `apps/web/test/hosted-mailbox-store.test.ts`
- `apps/web/test/hosted-runtime-internal-routes.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts`
- `packages/assistant-runtime/test/hosted-runtime-mailbox-import.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts`
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
