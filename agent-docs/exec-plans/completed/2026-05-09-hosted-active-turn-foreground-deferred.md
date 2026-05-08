# Hosted Active-Turn Foreground Deferred Checkpoint

## Goal

Keep hosted foreground active-turn input acceptance local/deferred so a supported accepted-input flow cannot trip workspace checkpoint guards, while preserving foreground tripwires for broad workspace persistence.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- Focused runner tests if needed

## Constraints

- Do not restore foreground workspace checkpointing or snapshot construction.
- Accepted-input journal/receipt durability remains owned by local Murph runtime state.
- Runtime logs stay metadata-only and redacted.
- Preserve unrelated active hosted-runtime edits and ledger rows.

## Verification

- Focused hosted-runtime workspace entrypoint/runner tests.
- `pnpm typecheck`
- `pnpm test:diff` scoped to touched files if feasible.

## State

Completed. Scoped commit blocked by overlapping dirty hosted-runtime work in the same files; plan archived and ledger row removed.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
