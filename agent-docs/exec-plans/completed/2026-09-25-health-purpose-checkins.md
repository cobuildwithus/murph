# Health-purpose connected-plan follow-ups

Status: completed
Created: 2026-09-25

## Outcome and scope

Connected plans remain useful private context without automatically generating
attendance or logistics questions. Follow-ups need a concrete health decision
or an explicit member request. Existing generic check-ins skip at execution;
the morning reconciliation retires proven automatic low-value follow-ups.
No new state, scheduler, delivery channel, or production mutation is needed.

## Product UX

- Entry and promise: connected-plan capture and existing scheduled notifications.
- Reaches: members with new or previously saved plans, useful health reviews,
  and explicitly requested reminders, including non-health reminders.
- Proof: silent capture without follow-up, suppression of a legacy logistics
  question, preservation of requested reminders and specific health reviews.
- Done when: composed prompt assertions and focused live journeys show those
  outcomes without replacing generic questions with generic wellness advice.

## Tasks

1. Replace automatic follow-up creation and repair with health-purpose eligibility.
2. Add the execution rule and preserve explicit-request authority.
3. Update owner docs, deterministic tests, and focused synthetic live journeys.
4. Run focused tests/typecheck, review the diff, and make a scoped commit.

## Evidence

- Focused connected-app prompt and managed-automation tests: 78 passed.
- Complete route-plan suite after updating only the scheduled-email fingerprint:
  106 passed. Direct, group, maintenance, and output-only fingerprints unchanged.
- Assistant Engine and affected package typechecks passed; Web typecheck passed.
- Changelog generation and archive render tests: 10 passed.
- Complexity guard passed with no complexity increase; existing hotspots untouched.
- Real Codex, `gpt-6-sol`, local subscription: legacy logistics check skipped;
  explicit non-health reminder sent; specific health review sent. Each had the
  correct single decision, with no wellness filler. UX verdict: Ready.
- Real Codex calendar capture without a health purpose: one canonical plan,
  zero follow-up writes, silent first pass and retry, preserved source mapping.
  UX verdict: Ready.
- Live commands use `pnpm test:assistant:live -- --test <exact scenario>`;
  the repository-authorized alternate-home path recovered pre-action failures.
- Real Codex requested partial-save recovery: one linked health follow-up at
  the requested end-relative time, no duplicate plan or follow-up on retry,
  and no immediate message. UX verdict: Ready.
- `pnpm test:diff` for the five changed Assistant Engine paths completed its
  guards and affected package typechecks. Assistant CLI passed 56 tests;
  Assistant Engine passed 5,392 tests with one stale scheduled-prompt snapshot.
  That expected snapshot was refreshed, with only scheduled email changing,
  and the full 106-test planning owner passed afterward. The broad command
  exited on its pre-refresh snapshot result; later dependent-package tests
  were not established green. Focused proof and typechecks above cover this
  prompt-only change; the broad lane was not repeated without a new concern.


## Review and delivery

The existing skill, managed recipe, scheduled prompt, and versioned automation
owner implement the change. No schema, scheduler, dependency, provider call, or
foreground await was added. Initial attended individual/group provider inputs
are unchanged; the guard is inside the existing scheduled-only prompt branch.
Prompt-primary work does not require external ReviewGPT under the completion
routing policy. This task prepares a local scoped commit; deployment and live
member behavior remain unverified until the change is released.

Changelog: `2026-09-25 / health-purpose-follow-ups`; no source PR is assigned
because this task has not opened a PR.

Updated: 2026-09-25
Completed: 2026-09-25
