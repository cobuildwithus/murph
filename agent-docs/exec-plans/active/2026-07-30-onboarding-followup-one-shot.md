# Spread and bound onboarding follow-up automation

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Replace the recurring 1:30 PM onboarding recovery automation with one
  finite, low-pressure next-day attempt whose local delivery time is
  deterministically spread across members.

## Success criteria

- New signup follow-ups resolve to a stable local time from 1:30 PM through
  2:29 PM rather than sharing one minute.
- The resulting canonical automation is a one-shot and is not rescheduled by
  idempotent signup-welcome processing.
- Existing managed recurring onboarding follow-ups migrate in place to the
  same finite one-shot contract without changing their route or pause state.
- The scheduled instructions permit at most one final reply-oriented nudge
  and make clear that a send or skip consumes the automation.
- Focused engine/runtime tests, relevant typechecks, exact-head CI, specialist
  review, and the proportional final review gate pass.

## Scope

- In scope:
  - onboarding follow-up schedule materialization and stable jitter
  - migration of existing managed recurring follow-up records
  - final-follow-up prompt policy and durable onboarding/runtime documentation
  - focused scheduler, managed-automation, and hosted-event coverage
- Out of scope:
  - signup welcome delivery
  - normal reply-driven onboarding
  - unrelated managed automation cadence
  - production data mutation or manual member outreach

## Constraints

- Technical constraints:
  - reuse canonical automation schedules and one-shot finalization
  - derive jitter from an existing stable member/vault key
  - add no persisted onboarding state or second lifecycle owner
  - preserve existing routes and paused records during migration
- Product/process constraints:
  - exactly one easy question in any sent continuation
  - respect explicit decline, deferral, and recent-conversation evidence
  - avoid broadcast-shaped copy and repeated unanswered setup questions
  - complete the worktree, PR, CI, and ReviewGPT workflow

## Risks and mitigations

1. Risk: a retry of signup-welcome processing moves the one-shot later.
   Mitigation: preserve an already materialized one-shot schedule by slug.
2. Risk: a legacy recurring pending occurrence survives migration.
   Mitigation: rely on the canonical scheduler's source-version reconciliation
   and add a focused schedule-change regression test.
3. Risk: finite scheduling removes legitimate onboarding progress.
   Mitigation: only scheduled recovery becomes finite; ordinary inbound replies
   continue through the existing onboarding skill and open-state owner.

## Tasks

1. [x] Add canonical one-shot-after-current-local-day authoring semantics.
2. [x] Add stable per-member local-time resolution to the onboarding definition.
3. [x] Seed new one-shots and migrate existing recurring managed records.
4. [x] Tighten the final-nudge instructions and update owner documentation.
5. [x] Add focused unit/integration coverage and run scoped verification.
6. [ ] Commit, push, open the PR, and complete the required review/CI loop.

## Decisions

- Use a deterministic 60-minute window beginning at 1:30 PM local time.
- Model the final follow-up as one canonical `at` occurrence. This makes the
  existing scheduler, rather than prompt compliance or a new state flag, the
  hard upper bound.

## Verification

- Commands to run:
  - focused assistant cron schedule/runtime tests
  - focused managed-automation tests
  - focused hosted runtime event tests
  - package typechecks for assistant engine and assistant runtime
  - exact-head GitHub Actions and required ReviewGPT passes
- Expected outcomes:
  - stable jitter stays within the intended local window
  - first occurrence is always after the current local day
  - an existing one-shot is preserved on reseed
  - legacy recurring records become one-shots without route/status changes
  - all focused and required exact-head checks pass

## Verification log

- Assistant-engine focused suites: 223 tests passed.
- Hosted-runtime event suite: 35 tests passed.
- Assistant-engine package typecheck: passed.
- Assistant-runtime package typecheck: passed.
- `git diff --check`: passed.
- Exact-head CI and ReviewGPT gates: pending the review-candidate push.
