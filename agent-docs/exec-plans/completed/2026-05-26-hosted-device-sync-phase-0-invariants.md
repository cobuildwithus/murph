# Hosted Device Sync Phase 0 Invariants

## Goal

Add regression coverage for the Phase 0 hosted device-sync/runtime invariants before larger foreground/background lane migration work:

- fresh conversation work takes priority over pending device-sync work
- webhook bursts coalesce dirty work instead of multiplying foreground wake work
- foreground input interrupts background maintenance before another device-sync unit starts

## Constraints

- Prefer tests only. If an invariant is already broken, make only the smallest production correction needed to make the invariant true.
- Do not inspect, print, fixture, or commit raw provider payloads, raw health data, secrets, local paths, or direct user identifiers.
- Preserve current legacy `device-sync.wake` compatibility while testing Phase 0 behavior.
- Do not introduce a new queue, snapshot store, or standalone sync plane in this phase.

## Plan

1. Map existing hosted runtime, hosted web, and device-sync test seams for the three invariants.
2. Add focused assistant-runtime foreground-priority and maintenance-yield coverage.
3. Add focused hosted webhook dirty-state coalescing coverage.
4. Run focused tests and required typecheck/verification for touched owners.
5. Run required completion audits and close with `scripts/finish-task`.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-workspace-runner.test.ts` passed.
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/device-sync-hosted-wake.test.ts` passed against the existing dirty webhook-burst coverage in the worktree.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts` passed.
- `pnpm typecheck` passed.
- Targeted diff whitespace and privacy scans for owned files passed.
- `security-privacy-review` reported no findings.
- `coverage-write` reported no changes needed.
- `task-finish-review` reported no findings.

## State

Complete. `scripts/finish-task` closed the plan but failed before commit after the active plan path was passed as an extra commit target; the scoped commit was recovered with `scripts/committer` over the completed plan and owned assistant-runtime tests only.
Status: completed
Updated: 2026-05-26
Completed: 2026-05-26
