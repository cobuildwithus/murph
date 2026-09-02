# Latency trace contention warning

Status: active
Created: 2026-09-02
Updated: 2026-09-02

## Goal

- Keep hosted latency trace writes non-blocking while warning only for rows that
  fail trace ownership or eligibility, not rows skipped during expected lock
  contention and recorded by the existing retry.

## Evidence boundary

- A bounded production trace completed staging, provider start, assistant
  output, reply handoff, and delivery even though Web warned about one rejected
  assistant milestone during the runtime retry window.
- The existing real-PostgreSQL proof shows `FOR UPDATE SKIP LOCKED` returns the
  same unmatched result for a contended row and records it after retry.
- Production evidence remains private and identifier-free; repository proof
  uses synthetic fixtures only.

## Constraints

- Do not wait on a contended trace row or put telemetry on the foreground reply
  critical path.
- Preserve the existing runtime retry and the three-field callback response.
- Keep true source, user, attempt, and lease rejection warnings intact.
- Add no state, dependency, queue, or database round trip.

## Tasks

1. Classify unmatched set-write rows that passed eligibility but were skipped
   because their trace row was locked.
2. Exclude those contended rows from Web's rejected-row warning count.
3. Prove warning behavior with route coverage and classification with the
   existing real-PostgreSQL contention scenario.
4. Run focused tests, Web typecheck, final review, exact-head CI, and close the
   plan through the normal scoped commit path.

## Done when

- A pure contention result emits no rejected-row warning and still returns the
  unchanged callback response.
- A genuine rejected row still warns with identifier-free counts.
- Focused unit and real-PostgreSQL checks pass.

## Validation

- `pnpm exec vitest run --config apps/web/vitest.config.ts
  apps/web/test/hosted-runtime-internal-routes.test.ts
  apps/web/test/hosted-runtime-latency-store.test.ts`: 108 tests passed.
- Dedicated migrated local PostgreSQL database with
  `MURPH_TEST_POSTGRES_CONCURRENCY=1`: 5 contention tests passed.
- `pnpm --dir apps/web typecheck`: passed.
