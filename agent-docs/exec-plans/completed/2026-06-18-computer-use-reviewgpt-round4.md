# Computer-Use ReviewGPT Round 4 Fixes

## Goal

Resolve the four accepted ReviewGPT High findings on the hosted computer-use PR:

1. Remove model-facing browser mutations for this release; keep observe/navigation/manual handoff.
2. Keep Kernel network calls out of Prisma interactive transactions.
3. Make handoff token expiry revoke only the link capability, not the browser run.
4. Stop retaining exact browser URLs or unused task goals in plaintext after terminal transitions.

## Constraints

- Keep the architecture conservative and composable; do not add a broader authorization framework in this round.
- Preserve durable `computer_pause_for_user` checkpoints and browser-session resume.
- Keep external browser/session cleanup retryable after DB transitions.
- Avoid storing exact third-party URLs, task history, or checkpoint text longer than needed.

## Working Set

- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/hosted-execution/src/computer-use.ts`
- `apps/web/src/lib/computer-use/**`
- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/2026061700_hosted_computer_use/migration.sql`
- Focused assistant-engine, hosted-execution, and apps/web tests for computer-use.

## Verification Plan

- Focused Vitest for computer-use service/store/handoff behavior.
- Focused assistant-engine tests for dynamic computer tools.
- Package/app typechecks for touched owners.
- `pnpm test:diff` where it truthfully covers the final diff.
- Required security/privacy, coverage, and deep-review completion passes.
- Push and rerun the external `review:gpt pr-review` loop.

## Current State

- Implemented: `computer_act` is navigation-only (`goto`) in the hosted-execution schema and assistant dynamic-tool schema.
- Implemented: pause/finish no longer wrap Kernel calls in a Prisma interactive transaction.
- Implemented: finish/expiry mark terminal DB state first, retain Kernel session until deletion succeeds, then clear the browser capability; cleanup retries terminal rows with retained sessions.
- Implemented: expired handoff tokens mark only the handoff expired; live awaiting runs can mint replacement handoffs capped to run expiry.
- Implemented: exact browser URLs are sanitized before persistence, terminal transitions scrub checkpoint/browser/task state, and unused `HostedComputerRun.goal` persistence is removed.
- Implemented: hosted computer navigation URLs are restricted to `http`/`https` at the shared schema boundary and repeated in the web service execution guard.
- Implemented: browser-state persistence is guarded by expected Kernel session and active status so stale observe/act results cannot rewrite scrubbed terminal URL/title fields.
- Implemented: terminal expired-row cleanup is classified as cleanup, not a newly expired run, and stale/concurrent expiry writes report whether they actually changed the row.

## Verification Notes

- PASS: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-execution-computer-use.test.ts apps/web/test/hosted-account-data-service.test.ts` (`98` tests).
- PASS: `pnpm exec vitest run packages/assistant-engine/test/assistant-codex-computer-tools.test.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts packages/hosted-execution/test/hosted-execution.test.ts` (`169` tests).
- PASS: `pnpm --dir apps/web typecheck`.
- PASS: `pnpm --dir packages/hosted-execution typecheck`.
- PASS: `pnpm --dir packages/assistant-engine typecheck` after building sibling workspace package entrypoints.
- PASS: `git diff --check`.
- BLOCKED unrelated: latest `pnpm test:diff` passed repo guards, affected package typechecks, assistant-cli, assistant-engine, assistant-runtime, assistantd, cli, cloudflare-hosted-control, and hosted-execution package tests, then failed in `packages/hosted-local-harness` on the two pre-existing workflow-contract assertions expecting `echo "${npm_prefix}/bin" >> "${GITHUB_PATH}"`; the checked-in workflows currently use `$GITHUB_PATH`. This is outside the computer-use diff.
- Completed local audit outputs: coverage-write added parser/scrub assertions; security/privacy found and fixed non-HTTP URL acceptance; deep-review found and fixed stale browser-state writes and expired-cleanup overcounting.
- Pending: PR push; external `review:gpt` loop.
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
