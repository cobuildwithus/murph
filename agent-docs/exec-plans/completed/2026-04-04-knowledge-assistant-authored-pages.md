# Knowledge Assistant-Authored Pages

## Goal

Replace the knowledge wiki's `review:gpt` compilation hop with a first-party assistant-authored write path so the calling Murph assistant model can synthesize and persist derived knowledge pages directly.

## Why

- The current knowledge flow delegates to a second model run through `review:gpt`, which makes the write path harder to reason about and splits synthesis away from the active assistant session.
- The assistant already has a bounded tool/write architecture for non-canonical Markdown memory, which is a better fit for derived knowledge pages than a separate browser-automation runner.
- The derived wiki should stay inspectable, rebuildable, and deterministic around page persistence, indexing, and linting without depending on a second model backend.

## Scope

- Replace `knowledge compile` internals with deterministic page persistence helpers.
- Add assistant-facing knowledge read/write tools where the assistant runtime can use them directly.
- Keep the existing derived knowledge page format, parser, search, lint, and index rebuild loop unless a narrow schema adjustment is required.
- Update assistant guidance and CLI descriptions to reflect assistant-authored compilation.

## Non-Goals

- Do not remove or redesign the separate `research` / `deepthink` commands unless the implementation proves they are tightly coupled to the same runtime in a way that blocks the knowledge cutover.
- Do not turn derived knowledge into canonical vault state.
- Do not introduce a new vector store or non-Markdown persistence layer.

## Constraints

- Preserve dirty-tree work outside the touched scope.
- Follow the assistant-memory pattern where it fits, but keep knowledge-specific normalization for slug/title/metadata, `## Sources`, related links, lint, and index rebuild.
- The resulting path must work for the active assistant provider surfaces, including Codex-backed runs.
- Repo docs and architecture notes must stay truthful if command semantics change.

## Intended Changes

1. Add a deterministic knowledge page write/upsert runtime that accepts assistant-authored markdown plus metadata/source inputs, saves the page, and rebuilds the knowledge index.
2. Rework `knowledge compile` away from `review:gpt`; either make it a pure persistence command or a thin wrapper over the new write/upsert runtime.
3. Add assistant-facing knowledge tools/guidance so the current assistant model can search/show existing pages and persist refreshed pages directly.
4. Remove stale `review:gpt` wording from the knowledge command manifest, prompt guidance, and related docs.
5. Add focused tests for assistant-authored page persistence, refresh behavior, normalization, and index/lint integration.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Risks

- Codex-backed assistant turns use a different execution path than the OpenAI-compatible tool runtime, so the assistant-facing write path must be chosen carefully.
- There is active overlapping work in the knowledge runtime files; preserve adjacent edits and keep the migration coherent.
- The CLI/user contract around `knowledge compile` may need a careful compatibility transition if the command stops performing its own model run.
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
