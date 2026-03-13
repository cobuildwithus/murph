# Incur Alignment

## Goal

Align `packages/cli` with incur-native routing, discovery, and typegen best practices by removing the manual `search` argv rewrite, promoting lexical search to `search query` so nested `search index ...` commands are truthful in incur discovery, enabling typed incur command-map generation, and trimming stale docs that restate incur-owned transport behavior incorrectly.

## Scope

- Replace the manual `search index status|rebuild` argv rewrite with native incur nested command groups, including the public lexical-search grammar change to `search query`.
- Export the root CLI in a form compatible with `incur gen`, commit the generated command-map typing artifact, and add root sync metadata for agent-skill generation.
- Update focused incur smoke helpers/tests and the frozen command-surface doc to reflect incur-owned behavior accurately.

## Constraints

- Preserve adjacent in-flight changes in the active CLI/search/docs lanes.
- Keep command semantics stable apart from the routing/discovery correction that moves lexical queries from `search` to `search query`.
- Do not broaden into unrelated read-envelope, inbox, or selector-normalization work.

## Outcome

- Replaced the manual `search` argv rewrite with a native incur `search` router that exposes `query` plus `index status|rebuild`.
- Exported the root CLI as a default export, added incur `sync` suggestions, and committed the generated `incur` command registration file for typed CTA command names.
- Aligned the focused incur smoke and search runtime tests with the new route shape and current help/error text.

## Verification

- `pnpm exec vitest run packages/cli/test/incur-smoke.test.ts --no-coverage --maxWorkers 1` ✅
- `pnpm exec vitest run packages/cli/test/search-runtime.test.ts --no-coverage --maxWorkers 1` ✅
- `pnpm typecheck` ❌ unrelated existing inbox typing failures in `packages/cli/src/commands/inbox.ts` and `packages/cli/test/inbox-cli.test.ts`
- `pnpm test` ❌ blocked by the same inbox typing failures during the root `pnpm build` step
- `pnpm test:coverage` ❌ blocked by the same inbox typing failures during the root `pnpm build` step
Status: completed
Updated: 2026-03-13
Completed: 2026-03-13
