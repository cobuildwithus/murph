# 2026-03-27 Parallel Refactor Batch

## Goal

Land the requested behavior-preserving clarity refactors across assistant orchestration, assistant automation, assistant channel delivery, Codex adapter plumbing, core mutation normalization, setup provisioning, and hosted onboarding webhook idempotency.

## Scope

- Refactor assistant turn orchestration in `packages/cli/src/assistant/service.ts` without changing failover, receipt, diagnostic, session-recovery, or delivery semantics.
- Extract the assistant auto-reply provider watchdog in `packages/cli/src/assistant/automation/scanner.ts` into a dedicated helper while preserving stall, heartbeat, and retry behavior.
- Simplify Telegram retry control flow and shared channel-adapter boilerplate in `packages/cli/src/assistant/channel-adapters.ts` while keeping delivery semantics identical.
- Clean up misleading Codex adapter abstractions in `packages/cli/src/assistant-codex.ts`.
- Separate normalized payload seeds from record id assignment in `packages/core/src/mutations.ts`.
- Make setup provisioning more data-driven across macOS/Linux and remove dead Linux apt bookkeeping in `packages/cli/src/setup-services.ts`.
- Make hosted onboarding webhook receipt handling retry-safe in `apps/web/src/lib/hosted-onboarding/service.ts` and add focused regression coverage.

## Constraints

- Shared current worktree only; use narrow worker lanes instead of extra worktrees.
- Preserve existing receipt timelines, diagnostic counters, cursor semantics, canonical record shapes, and user-visible step text unless tests deliberately prove otherwise.
- Do not revert unrelated dirty worktree edits.
- Respect the active overlapping assistant-runtime lane in the coordination ledger; keep one integrator on `packages/cli/src/assistant/service.ts` and `packages/cli/src/assistant/automation/scanner.ts`.
- Update docs only if behavior or operational assumptions materially change.

## Worker Split

1. `packages/core/src/mutations.ts` + `packages/core/test/device-import.test.ts`
2. `packages/cli/src/setup-services.ts` + `packages/cli/src/setup-services/steps.ts` + focused setup tests
3. `apps/web/src/lib/hosted-onboarding/service.ts` + hosted onboarding tests
4. `packages/cli/src/assistant/channel-adapters.ts` + `packages/cli/test/assistant-channel.test.ts`
5. `packages/cli/src/assistant-codex.ts` + `packages/cli/test/assistant-codex.test.ts`

Main integrator lane:

- `packages/cli/src/assistant/service.ts`
- `packages/cli/src/assistant/automation/scanner.ts`
- focused assistant runtime/service/robustness tests

## Verification Plan

- Focused Vitest runs for each changed slice during integration.
- Required repo checks:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Required completion audit passes via spawned subagents:
  - `simplify`
  - `test-coverage-audit`
  - `task-finish-review`
