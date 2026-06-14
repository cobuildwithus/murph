# Universal metric queryability

Status: completed
Created: 2026-06-12
Updated: 2026-06-12

## Goal

- Make every metric-bearing canonical observation event produce a query
  `MetricPoint` through the existing query projection/read path, while summary
  resolved wearable points remain authoritative for metrics owned by summary
  evidence.

## Success criteria

- Generic observation metric extraction supports known and unknown scalar metric
  keys with correct units.
- Summary-owned metrics such as `spo2` and `hrv` do not double-count raw
  observation points beside summary-resolved points for the same metric/day.
- Summary evidence ownership derives from the same table that emits evidence.
- Query projection SQLite version is bumped by one so stale projections rebuild.
- Required tests, `pnpm test:diff packages/query packages/cli`, and required
  completion audits pass.

## Scope

- In scope: `packages/query` metric extraction/projection logic and focused
  query tests.
- Out of scope: importer enrollment, wearable summary envelope/codec changes,
  CLI commands, new vault paths, new stores, browser-specific divergence unless
  inspection finds a separate metric extraction path.

## Constraints

- Technical constraints: use one generic observation extraction rule; no
  allowlist for observation metrics; derive summary precedence ownership from
  evidence tables; preserve existing summary conflict resolution.
- Product/process constraints: follow the spec in
  `agent-docs/product-specs/query-metric-universality.md`; keep the solution
  simple and composable; use the active-plan commit path.

## Risks and mitigations

1. Risk: suppressing raw observations too broadly could hide metrics the summary
   layer does not actually answer.
   Mitigation: suppress only summary-owned observation metric/day collisions and
   prove the behavior with targeted tests.
2. Risk: evidence ownership tables drift from evidence output.
   Mitigation: table-drive evidence generation and add a drift test against
   actual emitted keys.

## Tasks

1. Inspect current query metric extraction, wearable evidence, projection
   versioning, and browser-replica metric path.
2. Refactor summary evidence builders to table-driven definitions and export the
   derived ownership helper needed by extraction.
3. Add generic observation extraction with summary precedence suppression and
   bump query projection version.
4. Add targeted tests for surfaced observation metrics, double-counting,
   stale-version rebuild, and ownership drift.
5. Run required verification and completion audits, resolve accepted findings.
6. Finish with `scripts/finish-task`, push the branch, and open the PR.

## Decisions

- Use query projection rebuild rather than migrations because the projection is
  rebuildable and the spec requires only a version bump.

## Verification

- Commands to run: targeted query tests for the four spec proofs; `pnpm
  test:diff packages/query packages/cli`; required completion audits
  (`simplify`, `coverage-write`, `task-finish-review`).
- Expected outcomes: tests/checks pass, no unresolved accepted audit findings,
  active plan closed by `scripts/finish-task`.
Completed: 2026-06-12
