# Land MetricPoint labs and measurements projection patch

Status: active
Created: 2026-05-02
Updated: 2026-05-02

## Goal

- Land the supplied MetricPoint labs/measurements hard-cut patch so canonical vault event evidence can project into derived `MetricPoint` rows, unified browser-vault metric selections, and a rebuildable query projection table.

## Success criteria

- Browser-vault metric points continue to support wearable-derived metrics.
- Manual measurement/body-measurement/observation and lab-result evidence project into stable metric points with provenance.
- Query projection rebuild creates and populates `query_metric_points` from canonical vault evidence.
- Focused tests cover body weight unit normalization, body-fat percentage, ApoB, glucose selection priority, comparator rendering, and query-client latest/series access.
- Required package verification, audit passes, and scoped commit complete.

## Scope

- In scope:
  - `packages/query/src/browser-replica/metric-points.ts`
  - `packages/query/src/browser-replica/build.ts`
  - query projection schema/rebuild code directly needed for `query_metric_points`
  - focused `packages/query` tests for the new primitive
- Out of scope:
  - Hosted web UI changes.
  - New canonical vault write shapes.
  - Broad wearable metric redesign beyond preserving existing MetricPoint support.

## Constraints

- Technical constraints:
  - Query remains read-only relative to canonical vault writes.
  - New persisted projection state must stay rebuildable under `.runtime/projections/**` with explicit SQLite versioning.
  - Preserve package boundaries and public entrypoints.
- Product/process constraints:
  - Treat health data as high-sensitivity.
  - Preserve unrelated dirty work and active lanes.
  - Avoid local identifiers in code, docs, generated files, logs, and commit text.

## Risks and mitigations

1. Risk: Event-backed metric extraction could over-interpret incompatible vault shapes.
   Mitigation: Keep compatibility parsing explicit and covered by focused tests.
2. Risk: Projection version bump or migration path could break rebuilds.
   Mitigation: Verify query tests plus typecheck and smoke checks; inspect schema/version diff directly.
3. Risk: Overlap with active `packages/query` lanes.
   Mitigation: Keep the changed files scoped to the supplied patch and commit only this plan's files.

## Tasks

1. Apply the supplied patch script.
2. Inspect and adjust the diff against current `main`.
3. Run focused query verification, typecheck, and smoke checks.
4. Run required completion audits and address findings.
5. Close the plan and create a scoped commit.

## Decisions

- Classify `query_metric_points` as a rebuildable local projection under `.runtime/projections/query.sqlite`, not canonical product truth.

## Verification

- Commands to run:
  - `pnpm --filter @murphai/query test browser-vault-metric-points`
  - `pnpm typecheck`
  - `pnpm test:smoke`
- Expected outcomes:
  - All commands pass, or any unrelated pre-existing failure is identified precisely before handoff.
