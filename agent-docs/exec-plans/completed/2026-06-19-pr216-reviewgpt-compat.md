# PR 216 ReviewGPT Compatibility Follow-Up

## Goal

Fix the two High findings returned by ReviewGPT after the hosted E2E CI repair:
web/runtime rolling compatibility for mailbox fetch cursors, and preservation of
the conversation consumed floor across system-only import fallback.

## Constraints

- Keep protocol changes backward-compatible and minimal.
- Preserve the simplified runtime ack model; do not reintroduce replay coverage
  as consume proof.
- Keep mailbox ownership split: web owns server mailbox facts, runtime owns local
  import/checkpoint state.
- Do not expose local identifiers, secrets, or payload contents in committed
  artifacts.

## Current Evidence

- CI is green at head `e43a358bb`.
- ReviewGPT reported:
  - old runtimes can wedge against new web if the web always starts after local
    importedSeq while server consumedSeq is lower;
  - system-only fallback can drop the conversation consumed floor from the
    initial conversation fetch, causing replay catch-up acks to skip.

## Verification Plan

- Focused mailbox fetch protocol tests.
- Focused hosted runtime consume-ack tests.
- Hosted-local idle checkpoint scenario if runtime behavior changes.

## Verification Completed

- `pnpm --dir packages/hosted-execution test hosted-runtime-control.test.ts`
- `pnpm --dir apps/web test hosted-orchestration-reconciliation-facts.test.ts hosted-runtime-internal-routes.test.ts hosted-mailbox-store.test.ts`
- `pnpm --dir packages/assistant-runtime test hosted-runtime-mailbox-import.test.ts hosted-runtime-mailbox-checkpoint.test.ts hosted-runtime-workspace-runner.test.ts`
- `pnpm --dir packages/assistant-runtime test hosted-runtime-workspace-runner.test.ts hosted-runtime-mailbox-import.test.ts hosted-runtime-abort-guard.test.ts hosted-runtime-workspace-entrypoint.test.ts`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/cloudflare test runtime-bridge-workspace.test.ts`
- `pnpm --dir packages/assistant-runtime test hosted-runtime-platform-greenfield-ports.test.ts hosted-runtime-mailbox-payloads.test.ts`
- `MURPH_RUNNER_BUNDLE_SKIP_PACK_PREFLIGHTS=1 MURPH_RUNNER_BUNDLE_TEST_PARSER_TOOLCHAIN=1 pnpm --dir apps/cloudflare runner:bundle:hosted-local`
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/murph_test MURPH_HOSTED_LOCAL_E2E_REUSE_DATABASE_URL=1 pnpm hosted-local e2e idle-checkpoint-deferred-progress --no-bundle`
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/murph_test MURPH_HOSTED_LOCAL_E2E_REUSE_DATABASE_URL=1 pnpm hosted-local e2e telegram --no-bundle`
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/murph_test MURPH_HOSTED_LOCAL_E2E_REUSE_DATABASE_URL=1 pnpm hosted-local e2e direct-r2-presigned-put --no-bundle`
- `pnpm typecheck`

## Handoff Notes

- Use `scripts/finish-task` for the final scoped commit.
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
