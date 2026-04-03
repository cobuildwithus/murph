# Assistant web-search module split

## Goal

Split `packages/assistant-core/src/assistant/web-search.ts` into smaller internal modules so the implementation is easier to navigate and maintain without changing the existing public `./assistant/web-search.js` surface or web-search behavior.

## Scope

- Keep `packages/assistant-core/src/assistant/web-search.ts` as the stable external entrypoint.
- Extract the current request normalization, provider/runtime selection, HTTP/retry helpers, provider implementations, and result parsing/filtering into smaller sibling modules under `packages/assistant-core/src/assistant/web-search/`.
- Add only the smallest focused verification needed to prove the refactor did not change behavior.

## Non-goals

- No provider behavior changes, new search features, or new configuration keys.
- No changes to CLI tool definitions or other assistant runtime behavior beyond import rewiring required by the split.
- No durable architecture/doc updates unless the refactor changes an ownership rule, which it should not.

## Verification

- Run focused package-level checks that cover the touched assistant-core surface.
- Then run the repo-required verification commands for `packages/assistant-core` changes and record any unrelated baseline failures explicitly if they appear.

## Notes

- Preserve unrelated dirty-tree edits.
- Prefer small, role-oriented files over moving everything into one new giant helper.
Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
