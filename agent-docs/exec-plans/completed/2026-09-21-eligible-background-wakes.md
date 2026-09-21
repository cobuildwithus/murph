# Avoid ineligible background wakes

Status: completed
Created: 2026-09-21
Updated: 2026-09-21

## Outcome and architecture

The local candidate omits unclaimed managed research timers while existing
onboarding state is open. It reuses the execution owner's exact identities for
weekly insight, monthly improvement coach, and research scout. Canonical
schedules stay active. Ordinary use, unrelated schedules, accepted delivery,
running claims, retry work, and unreadable-state recovery retain their owners.

The existing post-reply reconciliation now refreshes cron eligibility even
when managed seeding is unchanged or no fresh default route is available.
It preserves the fully merged phase wake and provider cleanup. Foreground
yield and status-read failure retain the existing short retry, so completing
onboarding cannot leave research without a future wake.

Device pass summaries now total the existing committed-continuation proof
across all job diagnostics, including jobs outside the sixteen slowest samples.
This distinguishes advancing empty history from a stuck cursor without new
payload logging, schemas, persisted flags, queues, or scheduling owners.

## Investigated and deferred

- Engagement is channel-specific. Both provider events and scheduled chat-health
  inventory can change channel eligibility without a durable runtime handoff.
  Suppressing those timers safely needs a complete reactivation path in both
  producers; an event-only fix or global pause would be incomplete.
- Personal Patterns review eligibility depends on the current report, ledger,
  and local date. Keep its daily check instead of introducing cached eligibility.
- Webhook dirty-state transitions, retained mailbox work, nearby full pulls, and
  identical historical range/source/resource jobs already coalesce. No additional
  debounce or overlapping-range union is justified by the inspected evidence.
- Historical continuation only counts as progress after its successor commits.
  Empty imports alone do not prove a loop. Production investigation remained
  read-only; no member rows, identities, or payloads are included here.
- Non-connect empty history has an existing bounded fifteen-minute, one-hour,
  six-hour, then daily retry ladder. Some unresolved connect/resource history
  can retain daily readiness checks. Failure-attempt counters do not identify
  the history retry rung; current summaries cannot justify removing every
  retained follow-up or imposing a new expiry.

## Product UX and review

Local deterministic result: Ready. Open onboarding avoids known blocked timer
work; completion restores the existing occurrence. Ordinary use and reminders
remain eligible. Recovery retains running claims, retries, pending outbox
ownership, earlier phase work, provider cleanup, and foreground priority.

No prompts, tools, interpretation, reply content, or model send/skip decisions
change: the execution gate already skips these cases before model admission.
A real-model journey would not exercise the timer projection being changed.

Parent reviewed the complete diff, ownership, privacy, wake reactivation, and
complexity. The changed projection and existing post-checkpoint reconciliation
need no generic eligibility framework. Existing large execution and runtime
functions remain unchanged in complexity; unrelated extraction is unwarranted.
Changelog is not applicable: internal scheduling efficiency and telemetry only.

## Verification

- Dependency build: `pnpm -r --sort --workspace-concurrency=4 --filter
  '@murphai/assistant-runtime^...' build` passed.
- `pnpm --dir packages/assistant-engine exec vitest run --config
  vitest.config.ts --no-coverage test/assistant-cron-runtime.test.ts`:
  244 passed; the two subsequently added accepted-work cases passed with
  `-t 'preserves accepted research'`. The original projection regression was
  observed failing before implementation.
- `pnpm --dir packages/assistant-runtime exec vitest run --config
  vitest.config.ts --no-coverage
  test/hosted-runtime-workspace-assistant-phase-managed-automation.test.ts
  test/hosted-runtime-maintenance.test.ts`: 176 passed. The managed-automation
  file was rerun after the final runtime simplification: 42 passed.
- Relevant existing device-sync service continuation-commit cases: 2 passed.
- `pnpm --dir packages/assistant-engine typecheck` and
  `pnpm --dir packages/assistant-runtime typecheck`: passed after final edits.
- `pnpm complexity:diff`: passed; no added complexity debt in four source files.
- `git diff --check`: passed.

## Delivery boundary

This task produces the investigation and a verified local commit. No production
mutation, merge, or deployment was performed. PR publication is separate;
required final ReviewGPT and exact-head CI must run on that candidate before
claiming merge readiness or production improvement from this change.
Completed: 2026-09-21
