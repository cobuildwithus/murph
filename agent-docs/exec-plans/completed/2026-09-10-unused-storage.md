# Remove obsolete snapshot-writing APIs

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Outcome and invariant

Remove the testkit-only checkpoint producer and unused bundle-write convenience APIs. Keep live Web checkpointing, snapshot bridge lease stages, encrypted bundle reads, ownership validation, and garbage collection unchanged.

## Evidence and scope

The old checkpoint producer has only test callers. Bundle-store writes likewise create legacy test fixtures; current snapshots use the live snapshot bridge. Move that legacy writer into Cloudflare test support and exercise checkpoint lease diagnostics directly through the live Web checkpoint function.

## State and failure boundaries

No persistence format, checkpoint protocol, encryption envelope, or authorization changes. Preserve legacy decrypt, wrong-owner, integrity, retention, and retry coverage. Do not remove snapshot-stage labels used by live producers.

## Tasks

1. Remove obsolete checkpoint and bundle writer exports and implementations.
2. Move legacy fixture writes into test support and preserve live lease assertions.
3. Run focused checkpoint, bundle, crypto, retention tests and relevant typechecks.
4. Review the candidate, close this plan, commit and open a PR with exact-head CI and ReviewGPT.

## Verification

Assistant-runtime and Cloudflare typechecks pass. The live checkpoint and package-entrypoint suites pass 96 tests; bundle integrity/ownership and crypto suites pass 21 tests; three selected legacy retention, delayed cleanup and correctly bound test-artifact read scenarios pass. Complexity guard reports zero hotspots in all three changed source files; whitespace checks pass.

Parent candidate review verified the removed-symbol graph, preserved Web lease checks and response diagnostics, unchanged live snapshot producers and encrypted envelope fields, and real production reads in fixture-backed tests. Negative entrypoint and import-policy guards remain. No member-visible changelog or deployment protocol change. Exact-head CI and final ReviewGPT remain PR gates.
Completed: 2026-09-10
