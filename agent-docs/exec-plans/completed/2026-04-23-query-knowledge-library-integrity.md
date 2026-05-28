# Fix query health-library duplicate detection and preserve narrative knowledge sections

Status: in_progress
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Fail closed on ambiguous `bank/library` ownership and stop query-owned derived-knowledge readers from dropping legitimate narrative `## Related` or `## Sources` sections just because the heading names match generated metadata headings.

## Success criteria

- `readHealthLibraryGraph()` throws on duplicate library slugs or keys instead of silently collapsing one owner behind a `Map`.
- `readHealthLibraryGraphWithIssues()` records duplicate slug/key issues and omits ambiguous lookup entries from `bySlug` and `byKey`.
- `stripGeneratedKnowledgeSections()` no longer removes legitimate narrative sections by heading name alone; it strips only renderer-shaped generated sections at the tail of the body.
- Derived-knowledge graph/search tests prove that narrative `Related`/`Sources` content stays available in `DerivedKnowledgeNode.body`, summaries, and search snippets/hits.
- Query-package verification and the required completion workflow passes run, or any unrelated blockers are documented precisely.

## Scope

- In scope:
- `packages/query/src/{health-library.ts,knowledge-format.ts,knowledge-graph.ts,knowledge-search.ts}`
- directly coupled `packages/query/test/{health-library,knowledge-graph,automation-memory-knowledge-coverage,health-internals-coverage}.test.ts`
- directly coupled reverse-dependent test updates only if the query-package behavior change requires them
- `agent-docs/exec-plans/active/{2026-04-23-query-knowledge-library-integrity.md,COORDINATION_LEDGER.md}`
- Out of scope:
- unrelated dirty `packages/query` wearables/browser-replica work already in flight
- broader derived-knowledge renderer redesign, new persisted state, or assistant-engine product-surface changes unless a directly coupled reverse-dependent test proves they are unavoidable

## Constraints

- Technical constraints:
- Keep the `HealthLibraryGraph` surface stable; do not widen it with new duplicate buckets in this slice.
- In tolerant mode, ambiguous slug/key owners must not remain in the public lookup maps.
- Preserve current generated-section stripping for canonical rendered tails so existing derived knowledge pages still normalize correctly.
- Product/process constraints:
- An existing active row already covers `packages/query/src/health-library.ts` for validation failures, but the file is currently clean in the shared worktree. Keep the duplicate-owner change additive on top of that lane and stop if overlapping edits appear.
- Preserve unrelated `packages/query/**` edits and do not touch other active rows’ files unless a directly coupled test update is required.

## Risks and mitigations

1. Risk: strict duplicate rejection could break existing tolerant callers if the error path leaks into `readHealthLibraryGraphWithIssues()`.
   Mitigation: keep strict and tolerant graph construction explicit, with tolerant issue capture plus ambiguous-entry omission confined to the `WithIssues` path.
2. Risk: tightening knowledge-section stripping could leave generated metadata in bodies for legacy pages with drifted section order.
   Mitigation: keep the stripper focused on the safe generated tail shape and add regression tests for both trailing generated sections and preserved narrative sections.
3. Risk: reverse-dependent tests may assert the old stripping behavior.
   Mitigation: update only directly coupled tests if they fail under the safer semantics.

## Tasks

1. Completed: confirm the exact overlap state in the coordination ledger and shared worktree before editing these files.
2. Completed: inspect the current health-library and derived-knowledge graph/search implementation plus directly coupled tests.
3. In progress: implement strict duplicate detection and tolerant duplicate issue capture/ambiguous-map omission in `health-library.ts`.
4. Pending: make knowledge generated-section stripping preserve legitimate narrative sections while still stripping renderer-shaped generated tails.
5. Pending: add focused regression tests for duplicate slug/key handling and for preserved `Related`/`Sources` narrative content in graph/search paths.
6. In progress: run required verification, completion-workflow audit passes, and create a scoped commit if exact staging is possible in the dirty tree.

## Decisions

- Keep the `HealthLibraryGraph` type stable in this slice: ambiguous duplicates are omitted from `bySlug`/`byKey` rather than introducing a new duplicate-storage field.
- Treat duplicate slug/key issues as frontmatter-owned data-integrity problems for tolerant issue reporting so the exported issue surface does not need to widen beyond the current parser codes.
- Prefer the safer trailing generated-tail strip over broader heading-name removal; preserving legitimate narrative content takes precedence over scrubbing drifted legacy generated sections that are no longer structurally unambiguous.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/query/src/health-library.ts packages/query/src/knowledge-format.ts packages/query/src/knowledge-graph.ts packages/query/src/knowledge-search.ts packages/query/test/health-library.test.ts packages/query/test/knowledge-graph.test.ts packages/query/test/automation-memory-knowledge-coverage.test.ts packages/query/test/health-internals-coverage.test.ts`
- `pnpm test:smoke`
- `pnpm --dir packages/query test:coverage`
- `git diff --check -- <touched paths>`
- required `coverage-write` and `task-finish-review` audit passes
- Expected outcomes:
- strict graph reads reject duplicate slug/key ownership
- tolerant graph reads surface duplicate issues and omit ambiguous lookup entries
- derived-knowledge graph/search preserve legitimate narrative `Related`/`Sources` sections while still stripping generated tails
- Current outcomes:
- `pnpm exec vitest run test/health-library-duplicates.test.ts test/knowledge-generated-sections.test.ts test/automation-memory-knowledge-coverage.test.ts --config vitest.config.ts --no-coverage` in `packages/query` passed.
- An earlier focused `packages/query` run against `health-library.test.ts`, `knowledge-graph.test.ts`, and `automation-memory-knowledge-coverage.test.ts` also passed before the new assertions moved into fresh standalone files to avoid shared dirty test files.
- `pnpm --dir packages/query typecheck` passed.
- `pnpm test:smoke` passed.
- `pnpm --dir packages/query test:coverage` was red for unrelated pre-existing issues outside this slice; canonical wearable coverage blockers cited by the earlier run were removed by the later wearable evidence cleanup.
- `pnpm typecheck` is red for unrelated pre-existing `packages/device-syncd` typecheck failures.
- `pnpm --dir packages/assistant-engine typecheck` is red for unrelated pre-existing `packages/vault-usecases/src/vault-services.ts` typing failures.
- `pnpm exec vitest run test/knowledge-documents.test.ts --config vitest.config.ts --no-coverage` in `packages/assistant-engine` is blocked by an unrelated existing `packages/vault-usecases` export/config-resolution error.
- `git diff --check` on the touched paths passed.
- Required audit results:
- `coverage-write` reported no further coverage edits needed.
- `task-finish-review` reported no findings; residual risk is limited to the unrelated broader red verification lanes above.
