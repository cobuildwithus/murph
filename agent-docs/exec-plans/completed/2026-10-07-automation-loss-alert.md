# Scheduled automation loss alert

Status: completed
Created: 2026-10-07
Updated: 2026-10-07

## Goal

- Owner decision (2026-10-07): alert the operator when scheduled automation
  runs are lost across several runtimes. From 2026-10-05 to 2026-10-07 flex
  capacity rejections lost weekly health digests and morning journal runs for
  6 to 8 runtimes a day with no alert; only Personal Patterns has one.

## Success criteria

- One more monitor in the five-minute latency-alert cron opens the shared
  operational email incident when any runtime lost a scheduled run outright
  (never delivered across retries) in the trailing 6 hours. A lost run is `cron.occurrence.expired` after at least
  one failed attempt, or `cron.job.completed` failed with no retry scheduled
  (usage limits excluded).
- The email lists counts per allowlisted automation and failed attempts per
  allowlisted error code; no member identifiers, digests or raw values.
- PostgreSQL tests prove the 0/1/2 runtime boundary, the window, the exclusions
  (no prior failures, usage limit, retry scheduled, Personal Patterns) and
  label redaction.

## Scope

- In scope: new monitor in `apps/web/src/lib/hosted-runtime-log/`, cron route
  wiring, unit, PostgreSQL and cron route tests, and
  `docs/hosted-runtime-log-database.md`.
- Out of scope: the flex retry policy fix, the onboarding-gate expiry
  classification, member-created reminders that do not log expiry, and the
  Personal Patterns per-occurrence alert.

## Constraints

- Technical constraints: read the isolated runtime-log store through its
  existing time index, like the runaway monitor; no new state, cron, migration
  or member lookup.
- Product/process constraints: operator-only alert; no member-visible change.

## Risks and mitigations

1. Risk: noisy alerts from deliberate suppression.
   Mitigation: onboarding-gated research automations log
   `cron.occurrence.expired` with zero prior failures; requiring a prior
   failure excludes all 110 such rows from 2026-09-30 to 2026-10-07.
2. Risk: alert fatigue from delayed Flex runs.
   Mitigation: owner decision (2026-10-07) to alert on outright losses only.
   A run still retrying is never counted; the companion change gives Flex
   retry automations a 6-hour freshness window, so capacity dips delay rather
   than lose them. Retained logs from 2026-09-30 to 2026-10-07 hold 21 lost
   runs: 19 from the 10-05 to 10-07 flex rejections and 2 single-runtime
   onboarding follow-ups.
3. Risk: personal or free-text labels in email.
   Mitigation: only allowlisted managed automation slugs and error codes leave
   the store; anything else is `member_automation` or `other`.

## Tasks

1. Add the monitor and wire it into the latency-alert cron.
2. Add unit, PostgreSQL and route tests.
3. Document the contract in `docs/hosted-runtime-log-database.md`.

## Decisions

- Exclude `personal-patterns-update`; its per-occurrence alert already owns it.
- Alert on any outright loss (threshold 1): the owner wants every run a
  member never receives, not delays. An earlier 3-runtime threshold was
  replaced before merge.
- Send during quiet hours like the runaway monitor (ReviewGPT round 1,
  accepted): the 23:00–07:00 quiet period outlasts the 6-hour window, so a
  deferred loss early in the night would age out unreported.
- Changelog: internal-only operator alerting; no member-visible change.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-automation-loss-alert-monitor.test.ts apps/web/test/hosted-runtime-latency-alert-cron.test.ts` — 17 passed.
- `MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-automation-loss-alert-monitor-postgres.test.ts apps/web/test/hosted-runtime-runaway-alert-monitor-postgres.test.ts` against local PostgreSQL — 22 passed.
- Read-only production evaluation of the lost-run aggregate (about 0.3 s
  each): 0 runtimes at 2026-10-02T18:00Z and 1 at 2026-10-04T12:00Z
  (healthy); 3 at 2026-10-05T15:00Z, 6 at 2026-10-05T17:30Z, 6 at
  2026-10-06T17:30Z and 3 at 2026-10-07T15:30Z (alerting); 2 at
  2026-10-07T21:43Z (healthy). These counts used the earlier 3-runtime
  threshold; at threshold 1 the 10-04 single onboarding follow-up loss also
  alerts.
- After the threshold change: unit/route Vitest 18 passed; PostgreSQL 7 passed.
- `pnpm --dir apps/web typecheck`, focused ESLint, `pnpm complexity:diff`
  (new monitor max 8, no hotspot) and `pnpm docs:drift` passed.
Completed: 2026-10-07
