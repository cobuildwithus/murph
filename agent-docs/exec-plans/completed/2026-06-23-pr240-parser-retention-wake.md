# PR 240 Parser Retention Wake Fix

## Goal

Fix the ReviewGPT round-11 finding where an expired media attachment protected by a fresh pending/running parser job can consume the only inbox-media-retention wake and keep raw bytes indefinitely.

## Constraints

- Keep the fix inside the existing retention wake mechanism.
- Do not add a scheduler, queue, service, or new persisted state.
- Preserve active turn/save/promotion protections unchanged.
- Keep hosted sidecar rebuild behavior unchanged unless a test proves it must change.
- Continue checking the round-12 ReviewGPT thread while this fix is in progress.

## Plan

1. Make active parser-job protection return the protection-expiry timestamp instead of a boolean.
2. Merge that timestamp into `nextEligibleAt` during the initial candidate skip.
3. Merge the timestamp again during the locked recheck.
4. Add tests proving retention schedules the expiry wake and deletes media when that wake fires.
5. Run focused inbox/hosted-runtime verification, commit, push, and re-check CI.

## Verification

- Passed: `pnpm --dir packages/inboxd test -- inbox-media-retention.test.ts`.
- Passed: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-idle-maintenance.test.ts`.
- Passed: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-entrypoint.test.ts -t "inbox media retention wake"`.
- Passed: `pnpm --dir packages/inboxd test -- inbox-media-retention.test.ts idempotency-rebuild.test.ts`.
- Passed: `pnpm --dir packages/assistant-runtime test -- hosted-runtime-idle-maintenance.test.ts hosted-runtime-workspace-entrypoint.test.ts`.
- Passed: `pnpm typecheck`.
- Passed: `git diff --check`.
- `bash scripts/workspace-verify.sh test:diff packages/inboxd/src/indexing/retention.ts packages/inboxd/test/inbox-media-retention.test.ts packages/assistant-runtime/test/hosted-runtime-idle-maintenance.test.ts` passed affected package lanes through inboxd and assistant-runtime, then failed in unrelated `apps/cloudflare/test/runner-bundle-process.test.ts` because the synthetic Corepack home lacked the pnpm shim at `/tmp/home/.cache/node/corepack/v1/pnpm/10.33.0/bin/pnpm.cjs`.
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
