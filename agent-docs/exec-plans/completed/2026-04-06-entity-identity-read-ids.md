## Goal

Make one canonical read identity per entity family for query-backed reads, with stable meal/document family ids accepted as first-class `show` ids and assistant-core consuming shared query identity helpers instead of re-declaring the policy.

## Success Criteria

- `meal_*` and `doc_*` ids are treated as queryable read ids by the query-layer identity helpers.
- Generic `vault-cli show` accepts stable meal/document family ids without forcing a lookup-id/event-id translation step.
- `packages/assistant-core` no longer maintains its own duplicate query ID-family registry or meal/document lookup constraints.
- Prompt text and tests reflect the canonical family-id read path.

## Scope

- `packages/query/src/**`
- `packages/query/test/**`
- `packages/assistant-core/src/**`
- `packages/assistant-core/test/**`

## Constraints

- Preserve unrelated worktree edits.
- Keep event ids valid as provenance/read aliases where already supported.
- Do not invent a new cross-package adapter if the existing query helpers already cover the canonical behavior.

## Verification

- Focused Vitest coverage for `packages/query` and `packages/assistant-core`
- `pnpm typecheck`
- Required final review audit before commit

## Notes

- Prefer the “best” shape from the review note: stable family ids become the primary user-facing read ids for these families.
- If a narrower change is required, keep the resolver shared in `@murphai/query` rather than duplicated in assistant-core.
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
