# Hosted runtime runaway invocation alert

Status: completed
Created: 2026-10-04
Updated: 2026-10-04

## Goal and invariant

Detect subjects with at least 40 completed invocations in the trailing hour.
Keep raw identities and private payloads out of operational email and alert state.

## Owners and scope

Reuse the isolated runtime-log pool, shared operational email incident state,
and existing five-minute latency-alert cron. The current monitors do not count
per-subject invocation frequency. Derive health with one bounded aggregate per
evaluation; reuse the existing time index and add no schema or producer changes.
The incident owner retains send admission, retries, recovery and reminders.
Local missing configuration skips evaluation without clearing incident state;
database errors propagate without asserting recovery.

## Tasks

1. Done: add aggregate reader and monitor; wire the existing cron.
2. Done: prove threshold, privacy, recovery, reminders, configuration and cron wiring.
3. Done: update the storage owner doc and review the candidate. Close and commit locally after final checks.

## Decisions

- Use fixed threshold/window constants, matching sibling monitors; reuse existing
  recipient and timezone configuration.
- Return ten top subjects plus the full qualifying subject count. Send only
  digest prefixes and bounded known diagnostic labels.
- Changelog: internal-only operational detection; no member-facing behavior,
  interface or assistant changes.
- No push, PR, external review, deployment or production mutation in this task.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-runtime-runaway-alert-monitor.test.ts apps/web/test/hosted-runtime-latency-alert-cron.test.ts apps/web/test/hosted-device-import-alert-monitor.test.ts apps/web/test/hosted-runtime-progress-alert-monitor.test.ts`: passed, 61 tests.
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-runtime-runaway-alert-monitor-postgres.test.ts`: passed, six tests using connection-local temporary data only.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm complexity:diff`: passed, no hotspots; maximum changed function complexity 8.
- `git diff --check`: passed.
- `pnpm --dir apps/web exec eslint src/lib/hosted-runtime-log/runaway-alert-monitor.ts app/api/internal/hosted-runtime/latency-alert/cron/route.ts test/hosted-runtime-runaway-alert-monitor.test.ts test/hosted-runtime-runaway-alert-monitor-postgres.test.ts test/hosted-runtime-latency-alert-cron.test.ts`: passed.
- Candidate review: existing incident owner performs the fresh health recheck,
  retry admission, six-hour reminders, quiet-hours override and healthy reset.
  Aggregate uses the existing time-range index with no member lookup or schema
  change. Privacy tests cover malformed identity and diagnostic values.
- No Frog entry was needed. No foreground reply or assistant-input changes.
- External CI, ReviewGPT, production query performance and live email delivery
  remain unverified under the local-only handoff boundary.
Completed: 2026-10-04
