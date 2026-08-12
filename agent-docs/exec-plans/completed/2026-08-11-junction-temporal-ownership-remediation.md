# Fence Junction temporal features to complete source days

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Make closed date-by-date Junction pulls the sole owner of bounded daily
  blood-oxygen and stress temporal features.
- Ensure a later insufficient or capped complete-day result removes stale
  feature facets while retaining ordinary compact daily facts and no full
  timeseries.

## Success criteria

- Precise resource windows and webhook-style snapshot imports never publish
  day-scoped temporal features.
- Complete source-day imports replace the fixed feature-facet set through
  canonical versioned upserts and retractions.
- Order, retry, UTC/offset, insufficient-evidence, input-cap, and output-cap
  tests converge through the real core/query path.
- Generated contracts, durable docs, focused tests, and affected typechecks
  are current.

## Scope

- In scope:
  - Junction daily-fetch authority and source-local date filtering.
  - Importer-owned temporal facet reconciliation through existing core APIs.
  - Focused device-sync/importer/core/query tests and matching docs.
- Out of scope:
  - Full or downsampled timeseries retention, a new queue/state owner, UI work,
    or other P1/P2 audit gaps.

## Constraints

- Preserve base daily observations on every temporal suppression path.
- Keep source-day authority transient and out of retained raw artifacts.
- Reuse existing canonical event ownership; add no reconciler or merge store.
- Preserve the PR's immutable first-reviewed-head marker.

## Risks and mitigations

1. Risk: arbitrary precise chunks publish misleading day-level facts.
   Mitigation: require explicit complete-source-day authority passed only by
   the closed date fetch.
2. Risk: omission leaves older derived facets queryable.
   Mitigation: reconcile all fixed facets with versioned canonical retractions.
3. Risk: UTC filtering truncates an offset provider-local date.
   Mitigation: reuse importer source-day resolution for date-only responses.
4. Risk: remediation creates another timeseries state owner.
   Mitigation: retain only bounded scalar facts and compact evidence; replay
   through canonical upsert/retraction APIs.

## Tasks

1. Fence temporal reduction behind transient complete-source-day authority.
2. Reconcile omitted facets through canonical versioned retractions.
3. Prove precise ordering/retries and complete-day replacement behavior.
4. Regenerate the event schema and update durable ownership documentation.
5. Run focused verification, commit, push, and update the PR body.

## Decisions

- Keep ordinary daily aggregate ownership unchanged; only temporal features
  require the stronger date-fetch proof.
- Write canonical device upserts before their matching retractions so an
  interrupted attempt remains retry-safe and converges without extra state.
- Use the existing public event decision seam for retractions instead of
  extending core storage or adding lifecycle machinery.

## Progress

- Closed date fetches now carry validated transient source-day authority;
  precise imports carry none.
- The importer emits versioned feature upserts and canonical retractions for
  every omitted fixed facet, including insufficient and capped replacements.
- Date-only fetch filtering reuses importer source-local date semantics, and
  real core/query tests prove order, retry, offset, partial-facet, input-cap,
  and output-cap convergence without retained samples.
- The generated event schema and durable ownership docs are current.
- The corrected history-ownership foundation is integrated; daily imports
  retain successful peer resources before surfacing a retryable failure.

## Verification

- Junction importer/validation/boundary tests: 175 passed.
- Device-sync Junction provider/service tests: 331 passed.
- Real core/query temporal replacement tests: 2 passed.
- Contracts schema/catalog tests: 30 passed after generation.
- Contracts, core, importers, device-syncd, query, and vault-usecases
  typechecks passed.
- Workspace-boundary verification, docs drift, and docs gardening passed.
- Final diff/privacy checks and the corrected-foundation ancestry plus
  merge-tree proof passed.
Completed: 2026-08-11
