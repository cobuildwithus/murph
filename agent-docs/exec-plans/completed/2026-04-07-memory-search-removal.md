# 2026-04-07 Memory Search Removal

## Goal

Remove the dedicated `vault-cli memory search` surface so canonical memory is treated as one whole-file source of truth in `bank/memory.md` rather than a separate retrieval subsystem.

## Scope

- `packages/contracts/src/memory.ts`
- `packages/core/src/memory.ts`
- `packages/query/src/memory.ts`
- `packages/cli/src/commands/memory.ts`
- `packages/cli/src/incur.generated.ts`
- `packages/cli/test/memory.test.ts`
- `docs/contracts/03-command-surface.md`
- `docs/architecture.md`
- `e2e/smoke/scenarios/memory-search.json`

## Constraints

- Keep canonical memory reads/writes backed by `bank/memory.md`.
- Do not widen this task into transcript recall or broader assistant-memory redesign.
- Preserve unrelated dirty-tree edits, especially active hosted lanes.
- Keep command/docs language aligned with the simpler whole-file-memory model.

## Plan

1. Remove the `memory search` command and the now-unused search helper types/functions from the memory contracts/core/query surfaces.
2. Update generated CLI metadata, docs, and smoke/test coverage to reflect the smaller canonical memory surface.
3. Run focused verification, required review, and land a scoped commit limited to the touched files.

Status: completed
Updated: 2026-04-07
Completed: 2026-04-07
