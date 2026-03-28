# Assistant Provider Explicit Outcomes

## Goal

Make the assistant-provider failover and recovery flow in `packages/cli/src/assistant/service.ts` explicit through typed plans and attempt outcomes instead of branching through hidden mutable locals.

## Why

- The current provider-attempt loop mixes route planning, session recovery, cooldown bookkeeping, receipts, diagnostics, and final failover decisions in one mutable control path.
- High-stakes behavior such as cooldown failover, canonical write-guard blocking, and stale Codex session rotation currently depends on reconstructing intent from locals like `workingSession`, `attemptCount`, and `lastError`.
- The anchored robustness and service tests already define the behavior contract; this pass is about making that contract legible in the code.

## Constraints

- Preserve current failover, cooldown, receipt, and transcript semantics.
- Preserve canonical write-guard behavior, including suppressing failover/cooldown when the guard blocks a turn.
- Preserve stale Codex provider-session rotation and continuity-context behavior.
- Keep `sendAssistantMessage(...)` as the top-level orchestrator, but make the provider-attempt loop read like an explicit state machine.
- Avoid widening into unrelated assistant config or UI work even though adjacent assistant lanes are active.

## Target Shape For This Pass

1. Introduce explicit route-plan and attempt-outcome types that carry the exact data each orchestration step needs.
2. Split route-selection/bootstrap/session inputs from provider execution/recovery outputs.
3. Refactor `executeProviderTurnWithRecovery(...)` so each attempt returns a typed outcome such as success, retry-next-route, or terminal block/failure.
4. Keep receipt and diagnostic emission keyed off those typed outcomes rather than implicit local-state reconstruction.
5. Add tests only if the refactor exposes a narrow pure decision helper that lacks coverage.

## Expected Files

- `packages/cli/src/assistant/service.ts`
- `packages/cli/test/assistant-robustness.test.ts`
- `packages/cli/test/assistant-service.test.ts`

## Verification

- Focused assistant tests for the anchored failover, stale-session-rotation, and canonical-write-guard cases.
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Completion Notes

- Required audit sequence after implementation: `simplify` -> `test-coverage-audit` -> `task-finish-review`.
- Close this plan with `scripts/finish-task` if the task lands in this turn.

Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
