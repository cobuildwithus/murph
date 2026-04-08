# Raise `@murphai/assistant-engine` package-wide coverage with parallel test lanes

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Keep package-wide `coverage.include: ["src/**/*.ts"]` in `packages/assistant-engine/vitest.config.ts`.
- Keep `packages/assistant-engine` on the canonical repo coverage gate from `murphVitestCoverageThresholds` rather than any assistant-engine-specific override.
- Add more real package-local tests in parallel to materially improve `packages/assistant-engine` package coverage without owner-slice shortcuts.
- Preserve existing behavior and unrelated dirty edits in `packages/assistant-engine/**`.

## Success criteria

- `pnpm --dir packages/assistant-engine typecheck` passes.
- `pnpm --dir packages/assistant-engine test` passes.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --coverage` passes on the canonical repo-level per-file `85 / 80 / 85 / 85` gate.
- Coverage rises materially from the current honest baseline and the package no longer depends on an assistant-engine-specific threshold override.

## Scope

- In scope:
- `packages/assistant-engine/**`
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-assistant-engine-parallel-coverage.md}`
- Out of scope:
- other packages
- commits from worker lanes

## Current state

- `packages/assistant-engine/vitest.config.ts` still keeps `coverage.include: ["src/**/*.ts"]`.
- The package remains on the canonical repo threshold path with no assistant-engine-specific threshold override.
- The targeted user tail is now green:
  - `src/assistant/cron.ts` branches `80.69`
  - `src/assistant/cron/presets.ts` branches `89.28`
  - `src/assistant/local-service.ts` branches `91.66`
  - `src/assistant/outbox.ts` branches `85.94`
  - `src/assistant/runtime-budgets.ts` branches `82.6`
  - `src/assistant/turn-lock.ts` functions `93.33`
  - `src/assistant/web-fetch.ts` branches `80.48`
  - `src/knowledge/service.ts` branches `83.44`
- The canonical package verification is now green at `64` files / `579` tests with `94.84 statements`, `85.88 branches`, `97.11 functions`, and `94.87 lines`.

## Seam split

1. Automation support lane:
   - Owns `src/assistant/automation/{artifacts.ts,failure-observability.ts,grouping.ts,provider-watchdog.ts,prompt-builder.ts,runtime-lock.ts}` and `test/assistant-automation-support.test.ts`.
   - Goal: clear the remaining near-zero automation support files and lift the last automation branch misses.
2. Provider state lane:
   - Owns `src/assistant/{provider-binding.ts,provider-state.ts,provider-turn-recovery.ts}` and the provider final coverage tests.
   - Goal: finish the remaining provider state/recovery per-file failures without changing threshold wiring.
3. Outbox and provider-helpers lane:
   - Owns `src/assistant/{outbox.ts,outbox/retry-policy.ts}` plus `src/assistant/providers/{helpers.ts,registry.ts,codex-cli.ts}` and the provider final coverage tests or one disjoint companion file.
   - Goal: clear the remaining outbox and provider-helper branch misses.
4. Runtime small-seams lane:
   - Owns `src/assistant/{local-service.ts,runtime-budgets.ts,turn-lock.ts,reply-sanitizer.ts}` and the product/infra focused tests.
   - Goal: clear the still-red runtime helpers that are close enough to finish with deterministic tests.
5. Cron and infra branch lane:
   - Owns `src/assistant/{cron.ts,cli-surface-bootstrap.ts,web-fetch.ts}`, `src/assistant/cron/{locking.ts,presets.ts}`, `src/assistant/state/locking.ts`, `src/{outbound-channel.ts,process-kill.ts}`, `src/knowledge/service.ts`, and the cron/infra focused tests.
   - Goal: lift the remaining branch-heavy cron/external files above the canonical floor.

## Risks and mitigations

1. Risk: five workers collide in the same package files.
   Mitigation: assign one new focused test file per lane and keep source ownership disjoint.
2. Risk: workers chase giant orchestration files with poor coverage return.
   Mitigation: keep each lane on one primary module and prefer deterministic seams with mocked boundaries.
3. Risk: workers try to "solve" coverage by lowering thresholds or changing include lists.
   Mitigation: explicitly forbid threshold lowering and require the canonical repo threshold plus `src/**/*.ts` package scope to stay intact.

## Tasks

1. Register the assistant-engine lane and create this plan.
2. Spawn five GPT-5.4 `high` workers with disjoint test ownership inside `packages/assistant-engine`.
3. Integrate the returned tests carefully on top of the dirty package worktree.
4. Run package-local verification and coverage, then close remaining gaps locally.
5. Run the required final audit review before final handoff.

## This turn's narrowed ownership

1. Cron/web lane:
   - Owns new focused tests for `src/assistant/{cron.ts,cron/presets.ts,web-fetch.ts}`.
2. Runtime/outbox/lock lane:
   - Owns new focused tests for `src/assistant/{local-service.ts,outbox.ts,runtime-budgets.ts,turn-lock.ts}`.
3. Knowledge lane:
   - Owns new focused tests for `src/knowledge/service.ts`.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-runtime-thresholds.test.ts --config vitest.config.ts`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/assistant-engine test:coverage`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/assistant-engine test`
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --coverage`
Completed: 2026-04-08
