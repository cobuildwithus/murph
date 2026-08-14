# Junction Configurable Resource Modes

## Outcome

Make the five Junction timeseries resources that Murph already recognizes into
truthful, bounded opt-ins:

- `steps` and `distance` retain only provider-scoped UTC-day aggregates.
- `calories_active` and `heartrate` retain only bounded UTC-hour feature
  envelopes and never default raw samples.
- `weight` lands as a sparse canonical reading with the long history window.

The change must preserve source provenance, bounded vault growth, canonical
write ownership, idempotent replay, and default behavior for members who do not
enable these resources.

## Root-Cause Evidence

- `JUNCTION_KNOWN_TIMESERIES_RESOURCES` names all five resources.
- `JUNCTION_OPT_IN_TIMESERIES_RESOURCES` is empty, so the allowed set excludes
  all five.
- runtime normalization removes known-but-disallowed resources and replaces an
  explicitly supplied all-blocked list with defaults.
- the importer has bounded daily aggregation and sparse per-reading seams but
  no admitted policy for these five resources.

## Architecture

Extend the existing static Junction resource lists and importer owners. Do not
add a service, queue, database table, raw-sample store, compatibility shim, or
second source of truth. Derive runtime admission, history choice, sanitization,
and normalization from the smallest static policy that removes current list
drift without importing the provider implementation graph into boot-time
configuration. Aggregate identities must match the existing closed UTC-day
import boundary; do not introduce persisted state to merge provider-local days
or upstream sessions across independent transport windows.

## Work

1. Ask ReviewGPT Pro to implement the scoped change and return a patch artifact.
2. Inspect the patch against current ownership, privacy, bounded-growth, and
   package-boundary rules; apply only verified hunks.
3. Add or correct focused tests for exact opt-in admission, source-separated
   bounded aggregation, sparse weight readings, long weight history, and no raw
   timeseries retention.
4. Update the provider compatibility/runtime docs to describe the truthful
   modes and remaining exclusions.
5. Run focused package tests and typechecks, inspect the full diff, commit and
   open a PR, then run the required exact-head specialist and final ReviewGPT
   gates concurrently with CI.
6. Resolve accepted findings, complete the parent final review, close this
   plan, and leave the PR at a green reviewed head.

## Verification

- Focused importer resource-policy and normalization tests.
- Focused device-sync config, provider-manifest, and Junction provider tests.
- Typechecks for contracts, importers, device-syncd, health-metrics, and query
  owners touched by the patch.
- Direct fixture proof that high-volume resources emit only bounded aggregate
  evidence while sparse weight emits stable per-reading canonical facts.
- Exact-head required CI plus preliminary specialist and final ReviewGPT pass.

## Deployment

Keep the change backward compatible: defaults remain unchanged, opt-ins are
additive, and old runtimes ignore no new persisted schema requirement. If the
final design changes a shared Web/runner configuration contract, document the
safe deployment order and warm-runner compatibility before merge.
Status: completed
Updated: 2026-08-11
Completed: 2026-08-11
