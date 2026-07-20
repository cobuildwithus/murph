# PR 786 Catalog Temp Simplification

## Goal

Remove the seven one-off public-source ingestion pipelines from PR 786 while
preserving a recoverable local copy under an ignored product-tests temp path.

Success criteria:

- FDA cinnamon, FDA WanaBana, NY AG Holle, and FDA health-fraud parsers and raw
  fixtures are no longer tracked;
- the existing NYC, King County, and Pure Earth refresh path remains executable
  against the expanded product-test schema;
- deployed schema, remap safety, API, CLI, and product-detail behavior remain in
  the PR;
- docs and tests describe only the durable tracked workflow; and
- the PR is materially smaller without adding a new state owner or abstraction.

## Constraints

- Preserve the current local source artifacts under an ignored
  `apps/web/sql/product-tests/tmp/catalog-expansion/` directory before removing
  them from the tracked patch.
- Do not commit raw fixtures or one-time parser code from that directory.
- Preserve the existing-source catalog rows and all reviewed remap decisions.
- Do not start ReviewGPT round 6 without the explicit continuation decision
  required after the five-round cap.
- Do not merge the PR without explicit user instruction.

## Working Set

- `.gitignore`
- `apps/web/sql/product-tests/**`
- focused product-test tests and documentation that directly reference the
  removed one-time source pipeline

## Verification Plan

- Verify the ignored temp copy contains every removed source artifact.
- Run the focused product-test adapter, schema, metadata, integrity, remap, API,
  CLI, and product-detail tests affected by the PR.
- Run prepared typecheck and the repository-routed coverage-write, parent
  scope-and-shape, privacy, and final-review checks.
- Commit through `scripts/finish-task`, push the PR branch, update the PR body,
  and run required CI without starting ReviewGPT round 6.

## Outcome Evidence

- Preserved the pre-simplification adapters, registry, generator, tests, and
  seven raw fixtures under the ignored local temp directory; SHA-256 comparison
  proved every copy matches the prior tracked head.
- Removed the seven one-time source pipelines from the tracked registry,
  dispatch, parser module, fixtures, and adapter tests. The durable sync now
  covers only NYC DOHMH, King County, and Pure Earth.
- Kept the expanded CSV/schema contract, reviewed remaps, public API/CLI/UI
  behavior, and remap-generation safety unchanged.
- The simplification working diff deletes 1,337 lines and adds 36 before plan
  closure; the combined PR is reduced to 54 files and about 8.8k additions.
- Focused product-test verification passed 9 files with 109 tests passed and
  163 environment-gated tests skipped. The post-audit adapter/schema lane passed
  3 files and 41 tests.
- `pnpm test:diff` selected the full `apps/web verify` lane: typecheck, build,
  dev smoke, lint, and 5,861 tests passed, with 185 environment-gated tests
  skipped and only pre-existing lint/build warnings.
- The required coverage-write pass added one exact CSV-header/import-table
  alignment assertion and reported no remaining actionable coverage gap.
- Diff check, tracked-artifact guard, direct-identifier/credential scan, and
  parent scope-and-shape review passed.

Status: completed
Updated: 2026-07-20
Completed: 2026-07-20
