# Derived Knowledge Wiki

## Goal

Land a non-canonical, model-authored knowledge wiki under `derived/knowledge/**` that Murph can build through CLI tools, while keeping canonical vault boundaries intact.

## Scope

- Add a derived knowledge graph/read surface for `derived/knowledge/pages/**`.
- Add CLI commands to compile, list, show, lint, and index derived knowledge pages.
- Reuse the existing `review:gpt` runtime seam instead of inventing a second model runner.
- Update assistant guidance and architecture/readme docs so the new seam is discoverable and aligned with the product constitution.

## Constraints

- Keep compiled knowledge non-canonical and rebuildable.
- Do not introduce a new canonical query family or write path under `bank/**`.
- Prefer deterministic scaffolding around model-authored page content over hard-coded synthesis heuristics.
- Preserve unrelated dirty-tree work already present in the snapshot.

## Plan

1. Extract the reusable `review:gpt` runner seam so research and knowledge compilation share one path.
2. Add derived knowledge graph helpers plus CLI commands for compile/list/show/lint/index.
3. Wire assistant/operator guidance and update docs for the new `derived/knowledge/**` lane.
4. Run focused verification we can exercise safely in the snapshot and produce a patch file for local application.
# Derived Knowledge Wiki

## Goal

Land a non-canonical, model-authored knowledge wiki under `derived/knowledge/**` that Murph can build through CLI tools, while keeping canonical vault boundaries intact.

## Scope

- Add a derived knowledge graph/read surface for `derived/knowledge/pages/**`.
- Add CLI commands to compile, list, show, lint, and index derived knowledge pages.
- Reuse the existing `review:gpt` runtime seam instead of inventing a second model runner.
- Update assistant guidance and architecture/readme docs so the new seam is discoverable and aligned with the product constitution.

## Constraints

- Keep compiled knowledge non-canonical and rebuildable.
- Do not introduce a new canonical query family or write path under `bank/**`.
- Prefer deterministic scaffolding around model-authored page content over hard-coded synthesis heuristics.
- Preserve unrelated dirty-tree work already present in the snapshot.

## Plan

1. Extract the reusable `review:gpt` runner seam so research and knowledge compilation share one path.
2. Add derived knowledge graph helpers plus CLI commands for compile/list/show/lint/index.
3. Wire assistant/operator guidance and update docs for the new `derived/knowledge/**` lane.
4. Run required verification, land any drift fixes, and commit the scoped result safely.
Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
