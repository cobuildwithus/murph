# Knowledge Ownership Hard Cut

## Goal

Move derived-knowledge ownership out of the CLI package and into the shared headless boundary, add assistant-native knowledge tools, replace `knowledge compile` with `knowledge upsert`, and collapse knowledge-page metadata to a single source of truth.

## Why

- Derived knowledge is now assistant-authored and persisted directly, so the remaining architectural debt is ownership split, not model orchestration.
- The current shape still spreads the write path across `packages/cli`, the read/search path across `packages/query`, and assistant usage across prompt text rather than first-class tools.
- The page format still allows `sources` and `related` metadata to drift between frontmatter and rendered body sections, which adds linting complexity and weakens long-term maintainability.

## Scope

- Create a shared derived-knowledge service in `@murphai/assistant-core` for upsert/get/list/search/lint/index rebuild.
- Rewire CLI knowledge commands to consume that service instead of CLI-local runtime helpers.
- Add assistant-native `assistant.knowledge.*` tools and update prompt/watchdog/tool-catalog expectations.
- Replace `knowledge compile` with `knowledge upsert` at the CLI surface.
- Make frontmatter the canonical source for stable knowledge metadata and render `## Related` / `## Sources` from that structure.
- Update docs, tests, and architecture notes to match the new ownership and command shape.

## Non-Goals

- Do not redesign the separate `research` or `deepthink` flows.
- Do not introduce a vector index or non-Markdown persistence model.
- Do not move canonical health writes out of their existing owner packages.

## Constraints

- Keep the package graph acyclic and preserve `assistant-core` as the shared lower boundary below the CLI package.
- Preserve unrelated dirty-tree edits.
- Treat derived knowledge as non-canonical and rebuildable.
- Keep direct scenario proof at the built CLI or assistant-tool boundary.

## Intended Changes

1. Extract CLI-local knowledge runtime/doc helpers into assistant-core-owned knowledge service files with explicit exports.
2. Add assistant-native knowledge tools for search/get/list/upsert/lint, using the same service surface.
3. Rename the CLI write verb from `knowledge compile` to `knowledge upsert` and remove the legacy command name.
4. Change the knowledge document model so frontmatter owns `slug`, `title`, `pageType`, `status`, `summary`, `sourcePaths`, and `relatedSlugs`, while rendered Markdown sections are generated from those fields.
5. Simplify query parsing/linting around that canonical shape and remove stale metadata-drift rules that no longer belong in the steady state.

## Verification

- `pnpm --filter @murphai/assistant-core typecheck`
- `pnpm --filter @murphai/murph typecheck`
- Focused Vitest lanes for assistant knowledge tools, CLI knowledge commands, and query knowledge parsing/search
- Direct scenario proof for assistant-native knowledge tools or built CLI `knowledge upsert`

## Risks

- Tool-catalog additions can affect multiple assistant provider tests.
- The hard cut away from `knowledge compile` can break prompt/docs/tests if any reference is missed.
- Existing legacy knowledge pages may lose derived metadata unless the parser migration path is chosen carefully.

## Outcome

- Landed a shared derived-knowledge owner in `@murphai/assistant-core` with `upsert/get/list/search/lint/rebuildIndex` plus assistant-native `assistant.knowledge.*` tools.
- Rewired the CLI knowledge surface onto that shared owner, renamed the write verb to `knowledge upsert`, and removed the old CLI-local knowledge runtime/doc/lint modules.
- Made frontmatter the canonical knowledge metadata source and simplified query parsing/linting to treat rendered `## Related` and `## Sources` as generated output.
- Updated prompt guidance, watchdog detection, docs, and focused tests to the new assistant-authored knowledge flow.

## Verification Results

- `pnpm --filter @murphai/query build`
- `pnpm --filter @murphai/assistant-core build`
- `pnpm --filter @murphai/assistant-core typecheck`
- `pnpm --filter @murphai/murph typecheck`
- `pnpm --filter @murphai/query exec vitest run test/knowledge-graph.test.ts --config vitest.config.ts --coverage.enabled=false --maxWorkers 1`
- `pnpm --dir ../.. exec vitest run packages/cli/test/knowledge-runtime.test.ts packages/cli/test/knowledge-documents.test.ts packages/cli/test/incur-smoke.test.ts packages/cli/test/assistant-cli-access.test.ts packages/cli/test/assistant-service.test.ts packages/cli/test/inbox-model-harness.test.ts packages/cli/test/assistant-core-facades.test.ts --config packages/cli/vitest.workspace.ts --coverage.enabled=false --maxWorkers 1`
- Built CLI scenario: `knowledge upsert`, `knowledge show`, and `knowledge search` succeeded end-to-end against a temp vault.
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
