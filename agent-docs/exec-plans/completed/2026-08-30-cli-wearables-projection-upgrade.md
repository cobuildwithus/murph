# Rebuild carried wearable provider projections

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Ensure the public provider-slug normalization change cannot leave an existing
  query projection looking fresh while its persisted provider row keys use the
  prior underscore form.

## Success criteria

- The query projection SQLite version advances at the canonical schema owner.
- A carried v25 projection with an underscore provider key is stale even when
  its source manifest is unchanged.
- The first provider-filtered read rebuilds that projection and returns the
  canonical public provider data.
- Focused projection/query tests and affected typechecks pass before the draft
  PR candidate is updated.

## Scope

- In scope: the query projection version boundary, one upgrade regression, and
  PR/changelog evidence updates.
- Out of scope: connector policy, provider priority, or a bespoke migration.

## Product UX

- Effort: Patch.
- Affected agent: an agent querying a valid underscored provider alias after a
  CLI/runtime upgrade receives the connected evidence on the first read.
- Recovery: the existing projection freshness owner performs its normal full
  rebuild; no user action or source-data rewrite is required.

## Tasks

1. Bump the projection SQLite version with the provider-key reason documented.
2. Represent a carried v25 underscore-key store and prove first-read rebuild.
3. Run focused query tests/typechecks, commit, push, and refresh the draft PR.

## Verification

- Focused provider-scope and query projection upgrade tests.
- Query package typecheck, CLI package typecheck, diff/privacy checks.
- PR-linked changelog render test and Web typecheck after the final code head.

## Results

- The focused carried-v25 upgrade regression passed and proved that the first
  filtered read rebuilt `providers:future_ring` into `providers:future-ring`.
- The full provider-scope and normalized-wearable suites passed (39 tests),
  including the workout-feature underscore regression.
- The existing projection-version owner regression passed at v26, and the
  query package typecheck passed.
- Changelog/Web checks remain intentionally after the final code commit so
  their evidence is attached to the exact PR candidate rather than the
  superseded first draft head.
Completed: 2026-08-30
