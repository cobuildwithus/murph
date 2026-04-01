# Query Canonical Hard Cutover

## Goal

Remove the legacy `VaultRecord`-shaped query surface and make canonical entities the only query read-model vocabulary across `packages/query` and its live downstream callers.

## Why

- Section 2 of `docs/architecture-review-2026-04-01.md` called out the duplicate `CanonicalEntity`/`VaultRecord` read-model ownership.
- The previous pass narrowed ownership, but it intentionally preserved the record-shaped compatibility surface.
- The user explicitly wants a greenfield cutover, so this pass should delete that compatibility surface instead of preserving it.

## Scope

- `packages/query/src/**` where record-shaped query helpers still exist
- `packages/query/test/**` that assert record-shaped behavior
- any directly implicated downstream callers in `packages/assistant-core/**` and `packages/cli/**`

## Constraints

- Keep the semantic query behavior stable while changing the vocabulary and public API.
- Prefer canonical-entity-first helpers instead of adding another compatibility layer.
- Preserve unrelated dirty edits outside this lane.
- Use scoped verification if repo-wide commands remain blocked by unrelated known failures.

## Verification

- `pnpm --dir packages/query typecheck`
- focused/full `packages/query` Vitest for the migrated surface
- the highest-signal downstream checks for any migrated non-query callers
- broader root commands if they are no longer blocked by unrelated branch failures

## Commit Plan

- Use `scripts/finish-task` while this plan stays active so the completed plan artifact lands with the scoped cutover commit.
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
