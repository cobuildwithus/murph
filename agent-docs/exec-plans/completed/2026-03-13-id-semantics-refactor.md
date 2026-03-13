# 2026-03-13 ID Semantics Refactor

## Goal

Clarify retrieval-layer ID semantics without changing observable CLI lookup behavior. Separate the record identity surfaced in query results from the primary lookup id that the CLI accepts for follow-on reads, especially for meal/document events.

## Constraints

- Preserve existing `show` acceptance rules.
- Preserve existing response field names unless a rename is purely internal.
- Work on top of existing worktree changes.
- Keep query, CLI, docs, and tests aligned in one change.

## Files

- `packages/query/src/model.ts`
- `packages/query/src/id-families.ts`
- `packages/query/src/index.ts`
- `packages/query/src/search.ts`
- `packages/query/src/timeline.ts`
- `packages/query/src/export-pack.ts`
- `packages/query/test/query.test.ts`
- `packages/cli/src/vault-cli-services.ts`
- `packages/cli/test/runtime.test.ts`
- `README.md`
- `docs/contracts/03-command-surface.md`

## Notes

- `displayId` is the surfaced identity in query/read outputs.
- `primaryLookupId` is the preferred CLI/query lookup handle.
- `lookupIds` remains the full alias set for compatibility.
