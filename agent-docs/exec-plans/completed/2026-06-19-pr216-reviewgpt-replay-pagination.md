# PR 216 ReviewGPT Replay Pagination Follow-Up

## Goal

Resolve the latest PR 216 ReviewGPT findings around mixed-version mailbox fetch
compatibility and replay-prefix pagination while preserving the simplified
mailbox consume model.

## Constraints

- Keep web/runtime rolling compatibility narrow and explicit.
- Do not reintroduce the deleted dual-query replay-prefix architecture.
- Use existing mailbox retry/wake primitives for continuation instead of adding a
  new scheduler or persisted state owner.
- Preserve foreground conversation priority and do not process replay-only rows
  as fresh assistant input.

## Current Evidence

- Current head: `715c4c228`.
- Latest ReviewGPT reports:
  - old web may return rows below local imported watermark;
  - system fallback can drop conversation consumed metadata;
  - retained consumed replay pages can delay fresh tail delivery.
- Implemented follow-up keeps old-web replay rows below the local watermark
  payloadless/importless, schedules immediate continuation when `maxSeqByLane`
  proves a hidden tail, and preserves that mailbox retry across system fallback.

## Verification Plan

- Focused assistant-runtime mailbox import and workspace-runner tests.
- Focused hosted-web mailbox route/store tests if web cursor behavior changes.
- Owner typechecks and hosted-local E2E only if runtime execution behavior changes.

## Verification Complete

- `pnpm --dir packages/assistant-runtime test hosted-runtime-mailbox-import.test.ts hosted-runtime-workspace-runner.test.ts`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm typecheck`
- `pnpm test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts packages/assistant-runtime/test/hosted-runtime-mailbox-import.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts`
- `MURPH_RUNNER_BUNDLE_SKIP_PACK_PREFLIGHTS=1 MURPH_RUNNER_BUNDLE_TEST_PARSER_TOOLCHAIN=1 pnpm --dir apps/cloudflare runner:bundle:hosted-local`
- `DATABASE_URL=<local-postgres-url> MURPH_HOSTED_LOCAL_E2E_REUSE_DATABASE_URL=1 pnpm hosted-local e2e idle-checkpoint-deferred-progress --no-bundle`
- `DATABASE_URL=<local-postgres-url> MURPH_HOSTED_LOCAL_E2E_REUSE_DATABASE_URL=1 pnpm hosted-local e2e telegram --no-bundle`
- `DATABASE_URL=<local-postgres-url> MURPH_HOSTED_LOCAL_E2E_REUSE_DATABASE_URL=1 pnpm hosted-local e2e direct-r2-presigned-put --no-bundle`

## Handoff Notes

- Use `scripts/finish-task` for the final scoped commit.
Status: completed
Updated: 2026-06-19
Completed: 2026-06-19
