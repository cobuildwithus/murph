# Idle Device Sync Priority

## Goal

Make hosted device sync idle-only so foreground assistant replies never run or wait on device-sync work, while keeping idle device-sync failures from blocking the runtime idle checkpoint.

## Constraints

- Preserve the single hosted workspace writer.
- Do not add a detached same-container background promise, queue, table, worker, or scheduler.
- Preserve the existing staged dirty-ack work owned by the parallel dirty-ack task; this slice must not redesign that contract.
- If foreground input arrives, device-sync maintenance must yield/reschedule and assistant reply work must not depend on device-sync completion.
- Device-sync maintenance failures must reschedule device sync without throwing through an already-dirty idle checkpoint.

## Plan

1. Remove device-sync execution from the assistant automation lane.
2. Route due/recovery device-sync work through idle maintenance only.
3. Preserve or reschedule skipped device-sync wakes when foreground work takes priority.
4. Pass through the existing staged dirty-ack surface only where needed, without changing dirty-ack semantics.
5. Rename the assistant lane around automation-only behavior and keep device-sync-shaped metrics at the outer maintenance boundary only.
6. Add focused regression coverage for foreground priority, idle preemption, and idle checkpoint-safe device-sync failure.

## Verification

- Focused hosted assistant-runtime tests for workspace assistant phase and maintenance: passed.
- `pnpm --dir packages/assistant-runtime test:coverage`: passed.
- `pnpm typecheck`: passed.
- Focused Linq hosted-local regressions (`linq-first-contact`, `linq-webhook`, `linq-scheduled-reminder`): passed.
- `pnpm test:e2e:hosted-local`: passed.
- `pnpm --dir packages/cli exec vitest run --config vitest.config.ts --coverage`: passed.
- `pnpm verify:repo`: passed.
Status: completed
Updated: 2026-05-29
Completed: 2026-05-29
