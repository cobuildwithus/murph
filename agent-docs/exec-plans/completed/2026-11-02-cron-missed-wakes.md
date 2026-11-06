# Preserve canonical automation wake times

Status: completed
Created: 2026-11-02
Updated: 2026-11-02

## Outcome and ownership

Outcome: scheduled automations retain their occurrence wake until execution records a terminal outcome.
Reaches: hosted weekly/monthly schedules, onboarding-open members, and foreground-deferred maintenance.
Proof: failing synthetic wake/delivery regression, time-zone/DST cases, existing execution gates and retry suites.

Canonical schedules and per-job runtime history already own occurrence selection.
`resolveAssistantCronWakeEntries` adds an onboarding-only filter absent from claim selection.
It removes future research wakes without consuming their occurrences. A later unrelated wake
can claim the unchanged past occurrence, where expiry precedes the onboarding gate.
The maintenance-yield projection separately drops future unclaimed occurrences.

## Change and boundaries

Delete the redundant onboarding wake projection; retain execution-time onboarding admission.
Preserve future maintenance wake timestamps while keeping due maintenance deferred.
No new state, scheduler, retry policy, schema, prompt, or tool authority.
Existing runtime files remain readable across versions; old code retains the wake omission.
No push, PR, deploy, production mutation, or member messaging. Commit locally with the requested trailer.

## Tasks

1. Trace schedule derivation, retry/no-op finalization, and bounded de-identified timing evidence.
2. Add regression tests and observe failures before implementation.
3. Delete the redundant filter and correct the future-maintenance fallback.
4. Run cron/canonical, automation run-loop, hosted scheduling suites, typechecks and complexity diff.
5. Review privacy, scope, results and source delta; close this plan and commit through scripts/committer.

## Verification

Ready. Deterministic scheduling is the changed boundary; provider prose and tool behavior are unchanged.
External exact-head review/CI requires a pushed candidate and is outside this local-only brief.
Release-note publication belongs with an authorized shipping PR; this task produces an unshipped local fix.

- Root cause confirmed: bounded read-only log aggregates show the original future occurrence already
  present in earlier cron scans. Canonical `nextRunAt` is derived, not persisted independently;
  enqueue failure and no-op finalization update only the claimed job. No backward schedule rewrite.
- A 17:00 notification encountered by next-day 03:00 maintenance is 600 minutes late. The freshness
  windows are one hour ordinarily and six hours for eligible managed jobs, not ten hours.
- Regression first: five engine cases and two hosted DST replays failed before implementation.
  The final three hosted cases plus five engine cases also failed against the original source from
  `origin/main`, solely at omitted-wake assertions; the fixed source was restored afterward.
- Engine proof: `pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts --no-coverage
  packages/assistant-engine/test/assistant-cron packages/assistant-engine/test/assistant-automation-runtime.test.ts`
  passed all 587 tests in 14 files, including canonical occurrence, runtime, expiry and run-loop coverage.
- Hosted proof: cron-wake regression, maintenance, assistant-phase scheduling/managed-automation,
  and entrypoint scheduling/checkpoint-wakes/wake-gates suites passed 339 distinct tests in seven files.
  Five entrypoint cases initially lacked the compiled capture worker; the documented runtime build
  succeeded, then the two affected suites and the three hosted regression cases passed (45 tests).
- Both assistant-engine and assistant-runtime typechecks passed. The runtime regression fixture's
  required nullable route fields were corrected after its first typecheck.
- `pnpm --dir packages/assistant-runtime build` passed.
- `pnpm complexity:diff --base origin/main` passed; a scoped repeat confirmed unchanged hotspot
  debt in both source files after unrelated remote-base movement. No new hotspot or abstraction.
- Production source: 5 added, 36 removed, net -31 lines. No new persisted state or dependency.
- UX replay: weekly delivery across both New York DST transitions, monthly delivery, missing/present
  runtime records, unrelated failure then no-op, paused/one-shot/interval/maintenance shapes, existing
  onboarding skip gates, and future/due/released maintenance yield all preserved. Notification delivery
  is a synthetic edge; no real provider or member message was sent.
- Parent review: ownership, per-job state, retry/pending-delivery recovery, scope and privacy checked.
  No actionable findings. Existing schemas remain compatible; no deployment was performed.
Completed: 2026-11-02
