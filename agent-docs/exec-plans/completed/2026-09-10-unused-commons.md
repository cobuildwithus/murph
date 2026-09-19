# Remove obsolete Health Commons detail transformers

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Outcome and invariant

Remove the five unused Web detail transformers while preserving generated public projections, publication filtering, explicit content assertions, and private-run composition tests. Production pages retain their current owners and behavior.

## Evidence and scope

Repository references show only tests and one type-only trend comparison import depend on the old transformers. Replace that type with the current overview projection. Delete the old implementations; use narrow projections in tests and a small test-only composition fixture where full private-run models are required.

## State and failure boundaries

No persisted state, public endpoint, generation format, authority, retry, or deployment protocol changes. The package generator remains the content owner; Web projections remain the rendering owner. Keep publication and malformed-artifact checks.

## Tasks

1. Replace oracle comparisons with explicit content assertions and migrate useful generator tests.
2. Delete the obsolete files and verify references.
3. Run focused Web and generator tests, Web typecheck, and complexity guard.
4. Review the diff, commit, open the draft PR, then run required exact-head CI and ReviewGPT.

## Verification

The obsolete reference graph is removed. Focused Web projection, research, protocol, expert, private-run, and trend-comparison assertions pass after switching to current projections. Generator publication tests cover draft/hidden experiments, missing private bindings, incomplete biomarker publication, and protocol-relative expert images. Web and Health Commons typechecks pass. `pnpm complexity:diff` passes with no remaining changed-source hotspots; `git diff --check` passes.

Parent candidate review checked the deletion graph, surviving generated projection owners, explicit content assertions, and the test-only composition boundary. No product behavior or persisted contract changes. Internal-only cleanup needs no member-visible changelog or rendered UI change. Exact-head CI and final ReviewGPT remain PR gates.
Completed: 2026-09-10
