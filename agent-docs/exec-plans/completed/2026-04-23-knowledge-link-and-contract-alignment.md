# Align derived knowledge links and contracts

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Fix the derived knowledge path/slug drift so nested knowledge pages render correct index and related links, and make the public knowledge query contracts match the loader/search ownership boundaries.

## Success criteria

- Nested pages under `derived/knowledge/pages/**` keep their full relative path in generated index entries and related-page links instead of collapsing to `basename()`.
- Knowledge page slug validation in the public schemas matches the loader's kebab-case invariant.
- Search/result type ownership no longer exposes parallel `DerivedKnowledgeSearchHit` and `KnowledgeSearchHit` contracts from the root barrel for the same surface.
- Focused query tests cover the nested-link regression and slug-schema alignment.
- Required verification, audit passes, and a scoped commit land cleanly without touching unrelated active query lanes.

## Scope

- In scope:
- `packages/query/src/{knowledge-model.ts,knowledge-graph.ts,knowledge-contracts.ts,knowledge-search.ts,index.ts}`
- `packages/assistant-engine/src/knowledge/{service.ts,documents.ts}`
- directly coupled `packages/query/test/{knowledge-graph,knowledge-contracts,knowledge-boundary,knowledge-contracts-root-surface}.test.ts`
- directly coupled `packages/assistant-engine/test/knowledge-service.test.ts`
- `agent-docs/exec-plans/active/{2026-04-23-knowledge-link-and-contract-alignment.md,COORDINATION_LEDGER.md}`
- Out of scope:
- the active `packages/query` wearables and browser-replica lanes
- unrelated `packages/assistant-engine` provider/runtime lanes
- new knowledge storage/layout rules beyond aligning the current nested-page behavior
- broader query barrel cleanup outside the knowledge search/contracts surface

## Constraints

- Technical constraints:
- Preserve the current dirty tree and avoid overlap with active `packages/query/src/{wearables.ts,browser-replica/**}` work.
- Keep any `assistant-engine` change limited to preserving existing nested knowledge page paths during upsert; do not widen into broader knowledge-service redesign.
- Keep the knowledge graph independent from search-only modules and avoid adding new public subpath exports.
- Product/process constraints:
- Follow the plan-bearing repo workflow, including `coverage-write` and `task-finish-review` before handoff.
- Do not expose direct personal identifiers in plan text, diffs, tests, or commit metadata.

## Risks and mitigations

1. Risk: Changing the root barrel or search contracts could widen the public package surface unexpectedly.
   Mitigation: Keep the single public owner in `knowledge-contracts.ts`, have search depend on those types, and update the boundary tests in the same diff.
2. Risk: Nested-link fixes could drift between index rendering and related-page rendering.
   Mitigation: Centralize page-link rendering around the full path relative to `derived/knowledge/` and cover both call sites in tests.

## Tasks

1. Register the scoped knowledge lane in the coordination ledger and finalize the plan details.
2. Fix knowledge page link rendering to preserve nested paths relative to `derived/knowledge/`.
3. Preserve existing nested knowledge page paths during `assistant-engine` upserts so nested pages rewrite in place.
4. Align knowledge slug schemas and collapse duplicate search-result type ownership onto the contracts owner.
5. Add focused regressions for nested links, nested upserts, slug validation, and root-barrel/boundary expectations.
6. Run scoped verification, required audit passes, and create a scoped commit.

## Decisions

- Treat nested pages as supported for this slice because the loader already accepts them and search results already preserve the full `pagePath`.
- Make `knowledge-contracts.ts` the single public owner for knowledge page/search result interfaces and let `knowledge-search.ts` consume that owner instead of defining duplicate public result types.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/query/src/knowledge-model.ts packages/query/src/knowledge-graph.ts packages/query/src/knowledge-contracts.ts packages/query/src/knowledge-search.ts packages/query/src/index.ts packages/query/test/knowledge-graph.test.ts packages/query/test/knowledge-contracts.test.ts packages/query/test/knowledge-contracts-root-surface.test.ts packages/query/test/knowledge-boundary.test.ts packages/assistant-engine/src/knowledge/service.ts packages/assistant-engine/src/knowledge/documents.ts packages/assistant-engine/test/knowledge-service.test.ts`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts packages/assistant-engine/test/knowledge-service.test.ts`
- `pnpm test:smoke`
- Expected outcomes:
- The query knowledge tests and diff-aware lane pass.
- Any repo-wide blocker outside this slice is identified precisely if `pnpm typecheck` fails for unrelated reasons.
Completed: 2026-04-23
