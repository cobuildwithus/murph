# Measure device sync import no-ops

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

- Measure unchanged device imports and complete-source-day rereads using existing
  bounded operational logs, and recommend a cheaper historical recovery policy.

## Success criteria

- Applied, unchanged, failed, and unclassified imports are distinguishable.
- Pass totals include all observed jobs before slow-job sampling.
- Complete-source-day imports are counted separately, including those performed
  inside reconciliation jobs. Logs contain no source payloads or health values.
- Focused service/runtime tests and affected typechecks pass.

## Scope

- In scope: additive import outcome counters, regression tests, logging contract,
  official Junction documentation research, and requested external investigations.
- Out of scope: changing sweep cadence, authorization checks, or production state.

## Constraints

- Reuse existing importer results and log events; add no network requests or state.
- Preserve canonical import, recovery, and disconnect behavior.

## Risks and mitigations

1. Mistaking successful jobs or unknown importer results for unchanged imports.
   Count only explicit `applied: false` as no-op; failures and unknowns stay separate.
2. Biased rates from slowest-job samples.
   Aggregate all diagnostics retained for the bounded pass before sampling.
3. Mistaking a persisted write for newly learned health information.
   Document that applied imports can include evidence-only persistence.

## Tasks

1. Trace import outcomes and complete-source-day authority.
2. Add counters to existing service diagnostics and hosted pass summaries.
3. Verify classification, sampling, failure isolation, and privacy.
4. Research webhook lifecycle, provider exceptions, time ranges, and recovery.
5. Review the candidate and finish with a scoped commit.

## Decisions

- Retain historical recovery; evaluate cadence changes separately with outcome data.
- Internal telemetry has no member-visible changelog entry.

## Verification

- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts --no-coverage test/service.test.ts`:
  149 existing tests passed; the new fixture initially lacked encrypted token
  fields. Corrected the fixture and reran `-t 'import outcomes'`: passed.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-maintenance.test.ts`:
  112 passed, including full-pass counts beyond the 16-job sample through the
  real hosted log parser.
- `pnpm --dir packages/device-syncd typecheck`: passed after fixture correction.
- `pnpm --dir packages/assistant-runtime typecheck`: passed.
- `pnpm complexity:diff`: passed; no increase in above-threshold complexity debt.
- `pnpm logs:guard`, `pnpm docs:drift`, and `git diff --check`: passed.
- Parent reviewed source/tests, outcome classification, failure propagation,
  diagnostic copy isolation, bounded scalar wire fields, privacy, and local links.

## Outcome

- Existing pass logs now expose overall and complete-source-day persistence
  outcomes without extra HTTP calls or scheduling changes.
- Official Junction research covers webhook lifecycle, retries, Garmin behavior,
  resource availability, historical readiness, datetime windows, pagination,
  and documentation gaps. Recommendation: targeted refreshes plus a daily
  bounded fallback, after proving event targeting and measuring outcomes.
- Both requested Pro investigations completed and were checked against source.
  No additional safely removable source-authority read was established.
  Checkpoint suppression already exists on main in PR #3282; its full-status
  comparator is conservative and may retain many signals. Do not duplicate it.
- These were design investigations against supplied source, not an external
  review of this telemetry candidate. No PR, deployment, or cadence change
  belongs to this scoped commit. Production no-op rates require rollout and
  subsequent observation; no private production results are stored here.
Completed: 2026-09-11
