# Health Commons Runtime Catalog Removal Plan

Created: 2026-06-05

## Goal

Keep the Health Commons build-time catalog as the internal generator input, but
stop generating, loading, packing, or smoke-testing the large runtime catalog
monolith.

Success criteria:

- `packages/health-commons/generated/catalog.json` is no longer generated.
- `packages/health-commons/generated/entities.ndjson` is no longer generated
  unless a current runtime tool proves it still needs that raw entity stream.
- Runtime consumers use compact protocol artifacts:
  - `protocol-index.json`
  - `protocol-run-specs.json`
  - `protocol-family-graph.json`
- `packages/cli/src/commands/commons.ts` no longer loads the full catalog.
- `packages/cli/src/commands/experiment.ts` no longer loads the full catalog for
  `--from-protocol` or protocol-default hydration.
- Hosted runner smoke checks prove the compact artifacts are present and useful,
  not that `catalog.json` exists.
- Cloudflare runner bundle/deploy packing ships the compact protocol artifacts,
  not the monolith.
- Tests assert that runtime/package paths no longer depend on
  `generated/catalog.json`.

## Design

Default to deletion and radical simplicity.

The full catalog remains a build-time data structure inside
`buildHealthCommonsCatalog()`. Generated runtime output is split by actual
consumer need:

1. `protocol-index.json`
   - Used for protocol listing and first-pass protocol recognition.
   - Contains only lookup/list fields: key, route id, slug, aliases, title,
     summary, status, categories, revision, and simple traits.

2. `protocol-run-specs.json`
   - Used by `commons protocol show` and `experiment start --from-protocol`.
   - Contains runnable protocol fields only: protocol spec, safety, test plans,
     experiment onboarding, expected signal descriptions, revision, and summary
     metadata.
   - Excludes source corpus, full page body, route bundles, and unrelated entity
     types.

3. `protocol-family-graph.json`
   - Used by `commons protocol explore`.
   - Contains protocol/family nodes plus parent/child/related edges and starter
     traits.
   - Excludes full entities and source corpus.

These artifacts should be plain generated JSON with small runtime readers. The
readers may perform lookup, normalization, filtering, and stable sorting, but
must not recreate the old full-catalog reader or require command modules to
parse the monolith.

## Non-Goals

- Do not redesign Health Commons content authoring.
- Do not delete route bundles or web projection artifacts; they already avoid
  the monolith on web runtime paths.
- Do not preserve `catalog.json` as a compatibility shim for hosted runtime or
  CLI reads.
- Do not add a cache, daemon, or wrapper layer to hide the catalog parse cost.
- Do not touch the separate CLI lazy-dispatch worktree changes except where a
  catalog consumer in `commons.ts` or `experiment.ts` must change.

## Implementation Steps

1. Add compact protocol artifact builders and generated outputs.
2. Add runtime loaders/readers for the compact protocol artifacts.
3. Move `commons protocol list`, `show`, and `explore` to those readers.
4. Move `experiment --from-protocol` and protocol-default hydration to the run
   spec reader.
5. Update hosted runner smoke and Cloudflare packing to require compact
   artifacts.
6. Stop generating and packing `catalog.json` and `entities.ndjson`.
7. Update tests/docs, then run focused tests, typecheck where not blocked by
   unrelated dirty CLI lazy-dispatch files, and `git diff --check`.

## Verification Plan

- Health Commons build/runtime tests covering compact artifact generation and
  readers.
- CLI Commons coverage and experiment protocol-start tests.
- Cloudflare deploy-artifact and runner-bundle artifact tests.
- Workspace source-resolution tests.
- Relevant web Health Commons tests that previously imported the generated
  catalog as a fixture.
- Typecheck affected packages where the current worktree permits it.

Status: completed
Updated: 2026-06-05
Completed: 2026-06-05
