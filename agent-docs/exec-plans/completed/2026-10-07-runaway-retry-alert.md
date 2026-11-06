# Alert on processing retry storms at 20 per member-hour

Status: completed
Created: 2026-10-07
Updated: 2026-10-07

## Goal

- Owner decision (2026-10-07): catch smaller retry storms than the 60-attempt
  rule allows, without paging on busy healthy members. Add a third runaway
  trigger: at least 20 `runner.processing_finished` rows with outcome
  `retry_later` for one subject in the trailing hour.

## Success criteria

- The existing aggregate counts retries per subject, alerts at the new
  threshold, ranks by the worst ratio to any threshold, and the email shows each
  subject's retry count.
- PostgreSQL tests prove the 19/20/21 retry boundary with accepted attempts kept
  below the total threshold, that a busy accepted-only member does not alert,
  and that a retry-only storm outranks a larger accepted burst.

## Scope

- In scope: `runaway-alert-monitor.ts`, its unit and PostgreSQL tests, and
  `docs/hosted-runtime-log-database.md`.
- Out of scope: the 25-invocation and 60-attempt thresholds, window,
  reminders, recipients, and fixing the `processing_mode_conflict` storms
  themselves.

## Constraints

- Technical constraints: same single time-indexed aggregate; no new state,
  cron, migration or member lookup.
- Product/process constraints: operator-only alert; no member-visible change.

## Risks and mitigations

1. Risk: noisy alerts.
   Mitigation: read-only aggregates over 8,156 member-hours (2026-09-23 to
   2026-10-07, known loop subjects excluded) show 6 member-hours at 20 or more
   retries, all retry storms (five `processing_mode_conflict`, one
   `command_budget_exhausted`), about three per week. A total of 30 or more would
   also have flagged two healthy busy hours and missed two storms.

## Tasks

1. Add the retry count, threshold, ranking and email text.
2. Update unit and PostgreSQL tests; update the owning doc.

## Decisions

- Keep the 60-attempt total as a backstop; repeated accepted starts are
  covered by the 25-invocation rule.
- Changelog: internal-only operator alerting; no member-visible change.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-runtime-runaway-alert-monitor.test.ts apps/web/test/hosted-runtime-latency-alert-cron.test.ts` — 18 passed.
- `MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-runtime-runaway-alert-monitor-postgres.test.ts` against local PostgreSQL — 15 passed.
- Read-only production run of the new trigger set: no qualifying subject at evaluation time (21 ms).
- `pnpm --dir apps/web typecheck`, `pnpm complexity:diff` and `pnpm docs:drift` passed.
Completed: 2026-10-07
