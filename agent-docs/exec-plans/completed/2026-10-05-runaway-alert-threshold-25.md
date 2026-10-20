# Lower the runaway invocation alert threshold to 25

Status: completed
Created: 2026-10-05
Updated: 2026-10-05

## Goal

- Alert on slower runaway runtime loops. Owner decision (2026-10-05): open the
  existing runaway incident at 25 `runtime.invocation_finished` rows per
  subject in the trailing 60 minutes instead of 40.

## Success criteria

- The monitor constant is 25; SQL boundary tests derive from the constant and
  prove 24 stays healthy while 25 and 26 alert.
- The owning doc states the new threshold.

## Scope

- In scope: the threshold constant, its tests and `docs/hosted-runtime-log-database.md`.
- Out of scope: window, reminders, recipients, query shape and remediation.

## Constraints

- Technical constraints: no new state, query, cron or migration.
- Product/process constraints: operator-only alert; no member-visible change.

## Risks and mitigations

1. Risk: false alerts from legitimately busy members.
   Mitigation: read-only aggregates (about 7,000 member-hours, 2026-09-20 to
   2026-10-05, excluding the known loops) show p99 5 and a maximum of 22 per
   hour, so 25 had no historical hits; reminders stay at six hours.

## Tasks

1. Change the constant, derive tests from it, update the doc.

## Decisions

- Tests import the exported constant so future threshold edits stay local.
- Changelog: internal-only operator alerting; no member-visible change.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-runtime-runaway-alert-monitor.test.ts apps/web/test/hosted-runtime-latency-alert-cron.test.ts` — 17 passed.
- `MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-runtime-runaway-alert-monitor-postgres.test.ts` against local PostgreSQL — 7 passed (boundary at 24/25/26).
- `pnpm --dir apps/web typecheck` and `pnpm complexity:diff` passed.
Completed: 2026-10-05
