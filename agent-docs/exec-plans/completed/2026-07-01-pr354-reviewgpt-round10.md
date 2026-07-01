# PR 354 ReviewGPT Round 10 Fix

Goal (incl. success criteria):
- Resolve ReviewGPT round 10's finding that auto-reply delivery can continue
  after the member-channel barrier stops foreground observation.
- Success means a fresh runtime wake observed after that stop yields background
  delivery before provider dispatch, local verification passes, ReviewGPT is
  green, and CI is green.

Constraints/Assumptions:
- Keep foreground-preemption ownership in the hosted runner.
- Do not add another engine-level queue, scheduler, or delivery manager.
- Preserve the existing member-channel exclusive system catch-up behavior.

Key decisions:
- Treat a pending runtime wake that arrives while the foreground import loop is
  stopped as a runner-owned background-yield signal.
- Let the existing post-checkpoint delivery yield/reset path own prepared
  delivery cleanup and immediate assistant wake selection.

State:
- Local runner-owned yield fix verified; ready to commit and push.

Done:
- Confirmed the gap: `prepareAutoReplyDelivery` stops the foreground loop, then
  `shouldYieldBackgroundMaintenance` only reads imported foreground work.
- Routed the auto-reply barrier stop through the runner-owned loop stop.
- Added a runner regression proving a runtime wake after observer stop flips the
  background-yield signal before provider entry.
- Verification passed:
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-runner.test.ts -t "pre-auto-reply delivery preparation yields when a foreground wake arrives after observer stop"`
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-runner.test.ts`
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-assistant-phase.test.ts -t "member-channel barrier|foreground work appears after the member-channel barrier|remote system catch-up"`
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-assistant-phase.test.ts`
  - `git diff --check`
  - `pnpm typecheck`

Now:
- Commit the round 10 fix.

Next:
- Push, rerun ReviewGPT, and wait for GitHub checks.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts
- packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts
- agent-docs/exec-plans/active/COORDINATION_LEDGER.md
Status: completed
Updated: 2026-07-01
Completed: 2026-07-01
