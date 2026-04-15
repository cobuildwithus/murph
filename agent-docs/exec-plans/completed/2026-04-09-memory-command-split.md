# Execution Plan: Memory Command Split

Last updated: 2026-04-09

## Goal

Split canonical memory creation from existing-record edits so the default memory write path cannot silently replace another record through `--memory-id`.

## Scope

- `packages/cli/src/commands/memory.ts`
- `packages/cli/src/incur.generated.ts`
- `packages/cli/test/**`
- `packages/core/test/memory.test.ts`
- `packages/contracts/test/automation-memory-event-lifecycle.test.ts`
- `docs/contracts/03-command-surface.md`
- `e2e/smoke/scenarios/memory-upsert.json`

## Constraints

- Keep the canonical storage model as one `bank/memory.md` document with one record id per bullet.
- Preserve the existing core update capability by id, but move that behavior behind an explicit edit command.
- Do not introduce grouped-memory semantics, compatibility shims, or new persisted-state shapes.
- Preserve unrelated in-flight worktree edits.

## Plan

1. Split the CLI command surface into create-only `memory upsert` and explicit `memory update`.
2. Align tests, generated command typing, and command docs with the new semantics.
3. Run focused verification, complete the required final audit pass, and create a scoped commit.

## Verification

- Required: `pnpm typecheck`
- Focused: memory CLI/core/contracts tests and a direct in-process repro of add vs update semantics

## Notes

- User-reported bug: reusing a memory id while adding a new context line caused an existing identity line to disappear because `memory upsert` treated `--memory-id` as an in-place replace.
Status: completed
Updated: 2026-04-09
Completed: 2026-04-09
