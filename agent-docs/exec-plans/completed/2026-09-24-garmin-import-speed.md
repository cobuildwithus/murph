# Coalesce overlapping Garmin history fetch work

Status: completed
Created: 2026-09-24
Updated: 2026-09-24

## Goal and scope

Reduce repeated Garmin history reads caused by overlapping notification windows.
Coalesce bounded pending pull work at hosted runtime admission. Preserve each
notification acknowledgement, existing queued owners, retry continuations,
source authority checks, and inline webhook payloads. No production mutations.

## Product UX (Patch)

- Outcome: finish wearable history imports sooner without losing coverage.
- Reaches: new Garmin history bursts, existing queued work, and cold restores.
- Proof: overlapping synthetic windows execute fewer fetch days; all original
  payloads retain completion ownership; incompatible and already-owned work
  remains separate. Live speed improvement requires deployment and observation.

## Success criteria

- Demonstrate at least 2x fewer repeated day-fetch units on a synthetic burst.
- Prove bounded admission, cold restore, terminal acknowledgement, and isolation.
- Pass relevant tests, typechecks, complexity review, and candidate review.

## Decisions and constraints

- Only plain Junction Garmin timeseries fetches for steps, distance,
  active calories, and respiratory rate are eligible initially.
- Inline data, lifecycle events, backfills, cursor jobs, unknown payload fields,
  different sources, and disjoint windows retain current behavior.
- Merge only overlapping windows, with a maximum one-year union. Keep the
  existing queue and per-payload completion mapping as the sole durable owners.
- A retained original job prevents merging its group, preserving old continuations.
- Group identity includes original payload identities so fresh notifications
  cannot be acknowledged by an earlier fetch that did not observe them.

## Tasks

1. Add regression coverage through real hosted admission and recovery.
2. Add conservative provider eligibility and bounded coalescing.
3. Measure work reduction, verify recovery and existing behavior, update owner docs.
4. Review, close this plan, and create a scoped commit.

## Verification

- Before the implementation, the composed admission regression failed with five
  jobs instead of one. The legacy-owner case passed unchanged.
- `pnpm --filter @murphai/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-device-sync-runtime.test.ts --no-coverage`: 161 passed.
- `pnpm --filter @murphai/device-syncd exec vitest run --config vitest.config.ts test/hosted-hints.test.ts test/junction-provider-historical-fanout.test.ts test/junction-timeseries-source-reuse.test.ts --no-coverage`: 44 passed.
- `pnpm --filter @murphai/device-syncd --filter @murphai/assistant-runtime typecheck`: both passed.
- `pnpm --dir apps/web changelog:generate` and focused `apps/web/test/changelog-page.test.tsx`: generation succeeded, 10 tests passed.
- `pnpm complexity:diff`: passed; no new functions above 20 and no increased
  complexity debt. Existing unrelated hotspots remain unchanged.
- `git diff --check`: passed.

## Results and candidate review

Synthetic provider replay reduced daily endpoint calls from 150 to 42 (3.57x)
with deeply identical imported snapshots for all 42 unique days. This measures
work reduction, not end-to-end production latency. Runtime tests cover complete
and failed jobs, retained original owners, reversed-page cold restore, narrowed
continuations, disjoint windows, the maximum union, and fresh notifications.
Existing source-authority and historical-fanout regressions also pass.

Product UX: Ready for the scoped implementation. Full history coverage and
interruption recovery are preserved in the composed replay; no presentation,
assistant prompt, message delivery, or foreground scheduling changes. No new
network calls, database queries, persistent schema, concurrency, cache, or
source-authority bypass. Parent review found no unresolved correctness issue.
A changing dirty page can conservatively recreate shared work; this deliberately
preserves freshness instead of acknowledging new arrivals from an older fetch.

The release-note fragment describes reduced duplicate work without promising
an unmeasured speed multiplier. Its source PR list awaits PR creation.

## Remaining delivery work

Only local implementation and a scoped commit are authorized in this task.
The stable pushed PR needs final ReviewGPT and exact-head CI before merge.
Deployment and production observation are separate; no live speedup has been
claimed or production mutation performed.

Completed: 2026-09-24
