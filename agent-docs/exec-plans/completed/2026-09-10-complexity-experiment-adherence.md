# Collapse server experiment adherence count selection

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal and protected behavior

Simplify the query-owned experiment adherence summary while preserving target
selection, calendar and noncalendar session counts, confidence, expected progress,
status, and session evidence IDs. Canonical input remains read-only.

## Evidence and design

`buildAdherenceSummary` has cyclomatic complexity 67. It independently selects
occurrence, calendar, or noncalendar counts for confidence, completion totals,
and expectations. Resolve the applicable count result once through existing
adherence counters and derive the summary from that result. Keep calendar
construction before selection so invalid calendar inputs retain existing failure
behavior. No persisted state, public contract, dependencies, or authority change.

## Scope and decisions

- Source: `packages/query/src/experiments.ts` and focused experiment tests.
- Baseline: `b0a945bb87e20755d1cbbcfb3c32ec02c8f12fec`.
- Preserve the independent browser projection owner unchanged.
- Internal refactor; no member-facing changelog or new interaction is required.
- Root completion owner reviews the draft PR and owns readiness and final gates.

## Risks and mitigation

- Ambiguous targets must keep zero counts and unknown status; calendar rollups
  must use only their selected target's cells.
- Linked-event calendars constrain evidence IDs while metric and noncalendar
  targets retain existing evidence-list behavior. Cover these combinations.
- Optional confidence and partial fields retain their current omission rules.

## Tasks

1. Resolve one applicable adherence count source.
2. Run focused characterization, consumer tests, query typecheck, and guard.
3. Inspect privacy/diff, close this plan, commit, and open a draft PR.

## Verification

- The new public-query characterization passed against the unchanged baseline
  implementation before replaying it on the final candidate.
- `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage
  test/experiment-analysis.test.ts test/experiment-adherence.test.ts
  test/experiment-repeated-cadence-counts.test.ts
  test/browser-vault-experiment-results.test.ts
  test/experiment-open-ended-outcomes.test.ts`: 5 files and 215 tests passed.
- `pnpm --dir packages/query typecheck`: passed.
- `pnpm complexity:diff --base b0a945bb87e20755d1cbbcfb3c32ec02c8f12fec
  -- packages/query/src/experiments.ts`: passed. Summary complexity 67 to 31;
  private count helper 8; file maximum 67 to 47; debt 78 to 42; total 801 to 773.
- Remaining hotspots were inspected: unchanged coverage summary 47 and metric
  callback 24; the adherence summary retains explicit status precedence and
  optional-field rules. No further extraction is warranted in this scope.
- `git diff --check` and inspection of source, tests, plan, and PR text passed.
  No private identifiers or unrelated changes were found.
- `scripts/frog list` was reviewed; no task-actionable friction entry was needed.
- Root completion owner reviewed the proposed count ownership and confirmed the
  target-resolution and null-counter invariants. Draft readiness, exact-head CI,
  and final review remain with that owner.
Completed: 2026-09-10
