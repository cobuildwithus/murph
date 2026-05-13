# Active-Turn Poll Pump Coverage

## Goal

Close the post-fix test coverage gaps found during the four-agent review of the
active-turn poll pump removal.

Success criteria:

- Controller tests assert provider registration schedules no active-turn timer.
- Controller tests cover an in-flight rerun where the first notification accepts
  input and a second notification arrives before the first pass settles.
- Hosted runtime wake coverage proves staged same-conversation input is admitted
  and live-steered through the real store-backed input source.
- No production behavior changes are introduced.

## Constraints

- Preserve unrelated dirty work in the checkout.
- Keep changes test-only plus this execution plan.
- Do not reintroduce timers, polling, or compatibility pump behavior.

## Plan

1. Register this coverage follow-up in the coordination ledger.
2. Strengthen controller tests for timer absence and accepted-then-rerun
   coalescing.
3. Strengthen hosted runtime wake test with store-backed admission and live
   provider steering assertion.
4. Run focused tests and required verification before a scoped commit.

## Verification

Completed:

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-local-service-runtime.test.ts --testNamePattern "active-turn controller" --no-coverage`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-workspace-runner.test.ts --testNamePattern "runtime wake imports late conversation input without foreground checkpointing" --no-coverage`
- `pnpm typecheck`
- `git diff --check --` for the touched coverage files

Blocked/unrelated:

- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/test/assistant-local-service-runtime.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts agent-docs/exec-plans/active/2026-05-13-active-turn-poll-pump-coverage.md` passed assistant-engine and assistant-runtime tests, then failed in `packages/cli/test/assistant-codex.test.ts` because the CLI JSON-RPC initialize request included `capabilities.experimentalApi`; this coverage change does not touch `packages/cli` or Codex JSON-RPC plumbing.

Status: completed
Updated: 2026-05-13
Completed: 2026-05-13
Completed: 2026-05-13
