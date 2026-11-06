# Six-hour freshness window for Flex-retry automations

Status: completed
Created: 2026-10-07
Updated: 2026-10-07

## Goal

- Owner decision (2026-10-07): keep Flex pricing on retries for the managed
  automations with no user-promised delivery minute, and let a capacity
  shortage delay them rather than lose them. From 10-05 to 10-07 Flex
  rejections at the 13–15 UTC peak exhausted the 30 s/1 m/5 m/15 m retries of
  weekly digests and morning journal runs inside the 60-minute window, and 19
  runs expired unrun. Personal Patterns, on the same Flex retry policy with a
  four-hour window, lost none.

## Success criteria

- The six Flex-retry automations (Personal Patterns, morning journal context,
  weekly health digest, weekly health insight, weekly research scout, monthly
  improvement coach) stay deliverable for 6 hours after a recurring occurrence,
  so hourly Flex retries continue past the peak.
- One-shot schedules, other automations and any schedule whose next occurrence
  is under 6 hours away keep the 60-minute window, so a retry never replays a
  superseded occurrence.
- The Flex-retry set has one owner shared by tier selection and freshness.

## Scope

- In scope: `cron/canonical-jobs.ts`, `cron/execution.ts`,
  `managed-automation-ids.ts`, `managed-automations.ts` re-exports, freshness
  tests, `ARCHITECTURE.md`.
- Out of scope: retry backoff values, the tier policy itself, reminders and
  other delivery-time-sensitive jobs, the operator alert (#4082).

## Constraints

- Technical constraints: runner change; ships with the next runner release.
  No persisted state or schema change.
- Product/process constraints: members may receive these runs up to 6 hours
  late during a capacity shortage; owner accepted the delay.

## Risks and mitigations

1. Risk: replaying a stale occurrence after the next one is due.
   Mitigation: the long window applies only when the schedule's next
   occurrence is at least 6 hours after this one; daily, weekly and monthly
   managed schedules qualify, frequent custom schedules do not.
2. Risk: import cycle from cron code into managed automations.
   Mitigation: the five IDs move to the leaf `managed-automation-ids.ts`,
   re-exported unchanged from `managed-automations.ts`.

## Tasks

1. Move the IDs, add the shared set and window in `canonical-jobs.ts`, use the
   set in `execution.ts`.
2. Extend freshness tests; update `ARCHITECTURE.md`.

## Decisions

- Changelog: internal reliability change for scheduled background runs; no
  new member-facing promise.

## Verification

- `pnpm exec vitest run --no-coverage packages/assistant-engine/test/assistant-cron-freshness.test.ts packages/assistant-engine/test/assistant-cron-runtime.test.ts packages/assistant-engine/test/managed-automations.test.ts packages/assistant-engine/test/managed-automations-core.test.ts` — 384 passed.
- The composed runtime case fails a Flex occurrence for each of the six
  automations, then retries 5 hours later on Flex and succeeds; with the
  window set back to one hour all six cases fail.
- Freshness cases: 6 h deliverable and 6 h + 1 ms expired for daily-local and
  weekly/monthly cron schedules; one-shot, two-hourly cron, `every` and
  ordinary automations keep the 60-minute window.
- `pnpm --dir packages/assistant-engine typecheck`, `pnpm complexity:diff`
  (no changed function above its prior maximum) and `pnpm docs:drift` passed.
Completed: 2026-10-07
