# PR 354 ReviewGPT Round 9 Fix

Goal (incl. success criteria):
- Resolve ReviewGPT round 9's finding that unprepared non-idempotent background
  sends can be left in `sending` when foreground work appears at provider entry.
- Success means prepared effects still rethrow as hosted control flow after
  reset, unprepared effects fall through the outbox failure path as retryable,
  local verification passes, the PR head is pushed, ReviewGPT is green, and CI
  is green.

Constraints/Assumptions:
- Keep the round 8 outbox hook opt-in and narrow.
- Do not broaden foreground preemption architecture in this PR.
- The current outbox owner may persist retryable state for unprepared
  pre-provider foreground yield; hosted runtime only rethrows when it owns a
  prepared reset.
- ReviewGPT artifacts under `audit-packages/` stay uncommitted.

Key decisions:
- Accept the round 9 high finding.
- Mark hosted provider-entry yield as transient/retryable.
- Gate hosted `shouldRethrowDispatchError` on `preparedDispatch !== null`.

State:
- Local fix verified; ready to commit and push.

Done:
- ReviewGPT round 9 completed on pushed PR head `dad5092b` with CI green and
  one high accepted finding.
- Marked hosted provider-entry yield errors transient/retryable.
- Gated hosted outbox rethrow on `preparedDispatch !== null` so unprepared
  effects persist retryable state through the outbox owner.
- Added regressions for unprepared non-idempotent provider-entry yield and
  non-rethrown hosted-yield retry persistence.
- Verification passed:
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-callbacks.test.ts -t "unprepared provider-entry foreground yield"`
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-outbox-runtime.test.ts -t "hosted foreground yield"`
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-callbacks.test.ts`
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-outbox-runtime.test.ts`
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-cron-runtime.test.ts test/assistant-notification-turn-runtime.test.ts`
  - `git diff --check`
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-workspace-entrypoint.test.ts` failed once with two entrypoint isolation failures; isolated entrypoint rerun passed.
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-entrypoint.test.ts`
  - `pnpm typecheck`
  - `pnpm hosted-local e2e linq-scheduled-reminder`

Now:
- Commit and push the round 9 fix.

Next:
- Rerun ReviewGPT and wait for CI.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-runtime/src/hosted-runtime/callbacks.ts
- packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts
- packages/assistant-engine/test/assistant-outbox-runtime.test.ts
- audit-packages/pr-354-round-9.md
Status: completed
Updated: 2026-07-01
Completed: 2026-07-01
