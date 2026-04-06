## Goal

Hard-cut meal/document identity semantics to the greenfield end-state: stable family ids become the only family-surface read ids and follow-on lookup ids, while `evt_*` stays provenance/internal instead of being the preferred follow-on read identity.

## Success Criteria

- Query-backed meal/document entities use the stable family id as the canonical primary lookup identity.
- Meal/document write results return `lookupId` equal to `mealId` or `documentId`.
- Family-specific `show|manifest|edit|delete` commands for meals/documents accept only stable family ids.
- Raw manifest provenance and inbox-promotion lookup ids align to the stable family ids.
- Docs/tests reflect the greenfield cut and no touched tests still expect `evt_*` as the primary follow-on id for meals/documents.

## Scope

- `packages/query/src/**`
- `packages/query/test/**`
- `packages/core/src/**`
- `packages/assistant-core/src/**`
- `packages/cli/src/**`
- `packages/cli/test/**`
- `docs/contracts/03-command-surface.md`

## Constraints

- Preserve unrelated worktree edits.
- Keep `eventId` available as provenance/internal metadata.
- Avoid introducing another translation helper layer; remove semantic drift at the source instead.

## Verification

- Focused Vitest coverage for query, assistant-core, CLI, and inbox/document-meal seams
- `pnpm typecheck` if the repo-wide blocker state allows it, otherwise package/touched-lane typechecks plus explicit blockers
- Required final audit before commit

## Notes

- This is a greenfield cutover: there is no live data to migrate and no need to preserve the old meal/document follow-on read path as the preferred surface.
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
