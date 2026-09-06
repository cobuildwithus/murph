# Improve Personal Patterns comparison evidence

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Outcome and owner

Improve the reliability of the existing context-to-outcome report in
`packages/query`. Canonical events remain authoritative; Browser Vault and
CLI consume the same deterministic calculation. Preserve report identities,
missing-data semantics, bounded windows, and association-only interpretation.

## Investigation and scope

Trace factor extraction, outcome alignment, matching, grading, and refresh.
Use an authorized private export in memory to assess practical gaps. No private
records, distinctive examples, identifiers, or export contents enter committed
artifacts. Reproduce accepted gaps with independently constructed synthetic
histories before changing the query. No new service, dependency, or data store.

## Product UX

Entry: a member opens Patterns or requests the existing report.
Promise: useful comparable evidence earns proportionate strength.
Reaches: established wearable histories, sparse records, manual context,
multi-day episodes, corrected evidence, and inconsistent outcomes.
Proof: shared query regression tests, report serialization, and private replay.
Presentation and consent remain with their existing owners.

## Tasks

1. Establish baseline, identify concrete evidence defects, and select fixes.
2. Add failing synthetic histories; implement the smallest owner corrections.
3. Replay rich, sparse, repeated, inconsistent, and corrected histories.
4. Update the product contract and member-facing changelog.
5. Run focused tests, typecheck, complexity review, and inspect the complete diff.
6. Close the plan and make a scoped local commit; report deployment separately.

## Verification

Baseline: the existing Personal Patterns suite passes all 32 tests.
Pending: defect reproductions, changed suite, query typecheck, privacy review,
complexity guard, and private before/after report comparison.

## Completed decisions and evidence

- Replaced greedy nearest-day selection with weekday-separated date assignment:
  maximize matched days, then minimize total distance within the existing
  35-day boundary. Outcome values never influence assignment.
- Derive independent episodes by merging overlapping day sets. Removed the
  redundant episode-id counter so factor metadata and cell evidence agree.
- Require 75% direction agreement plus a meaningful median paired effect,
  retaining the existing chronological-half check and sparse evidence grades.
- Synthetic regressions failed on the original implementation: lost usable
  comparison and grades A/B awarded to contradictory or outlier-driven data.
- Exhaustively compared matching against an independent brute-force oracle
  over 2,187 small histories, including crossing assignments.
- Private in-memory replay improved coverage and withheld inconsistent early
  signals while retaining stronger patterns. Removed diagnostic source files;
  no private export data was written into the repository or fixtures.

## Verification results

- `pnpm --dir packages/query test test/personal-patterns.test.ts test/personal-pattern-matching.test.ts`: 41 passed.
- `pnpm --dir packages/query typecheck`: passed.
- `pnpm --dir apps/web test -- changelog-page.test.tsx`: 9 passed, including
  production archive rendering of the authored entry and its Patterns link.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm complexity:diff`: passed; no changed source hotspots above 20.
- `git diff --check`: passed.
- Parent review: canonical ownership, missing-data boundaries, outcome-blind
  matching, no day reuse, episode independence, and retained synthetic success
  paths checked. Product UX: Ready for the local change.

## Delivery boundary

Scoped local change only; no PR, remote review, deployment, or production data
mutation is part of this completion. Existing report schemas remain compatible.
The calculation takes effect when the deployed runtime next builds a report;
unchanged-input Browser Vault caching retains the previous report until the
normal refresh has changed evidence. Grades remain product evidence heuristics,
not significance tests, multiple-comparison correction, or causal estimates.
Completed: 2026-09-06
