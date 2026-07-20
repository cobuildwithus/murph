# PR 803 suite termination owner

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Resolve ReviewGPT round two by making the E2E suite's first accepted signal
  permanently close admission of later preparation, scenario, and batch work.
- Preserve exact current-run child/process-group teardown without adding a
  process manager, registry, queue, or persisted cancellation state.

## Success criteria

- One local suite termination state owns work admission across foreground
  commands and the cleanup gaps between them.
- In-progress cleanup may finish within its existing bound, but no later
  foreground command starts after SIGINT, SIGTERM, or SIGHUP is accepted.
- Repeated signals do not create another teardown or reopen admission.
- Pre-scenario and between-batch signal regressions pass, exact-head CI is
  green, and ReviewGPT round three returns `PASS`.

## Scope

- Hosted-local E2E suite signal listeners, work-admission checks, and focused
  suite tests.
- PR intent, change-shape, verification, and retrospective metadata.

## Constraints

- Keep termination state invocation-local and non-persisted.
- Allow only already-owned bounded cleanup after admission closes.
- Preserve existing foreground exact-child/process-group teardown as the
  subordinate cleanup primitive.
- Preserve unrelated overlapping hosted-local E2E plan work.

## Verification

- Focused E2E signal tests for active-child, pre-scenario cleanup, and
  between-batch cleanup windows.
- Hosted-local typecheck, owner coverage, truthful diff verification, required
  `coverage-write`, PR CI, and ReviewGPT correction round.

## State

- Round two returned `RETROSPECTIVE_REQUIRED` for a repeated split
  observation/admission mechanism.
- The required retrospective and explicit continuation decision are recorded
  in the PR discussion.
- The suite now keeps persistent handlers for all owned termination signals and
  closes one invocation-local admission gate before and after preparation,
  cleanup, scenario, and batch boundaries.
- Focused signal tests and hosted-local typecheck pass. Owner coverage passes
  with 402 tests and 1 skip at 83.90% statements, 75.57% branches, 83.44%
  functions, and 83.91% lines.
- Truthful diff verification passes for hosted-local and Cloudflare owners,
  including 1,842 Node tests and 1 Workers test. The required coverage-write
  audit found no gaps after rerunning the 16 focused signal/process tests.
  ReviewGPT round three remains before final PR handoff.
Completed: 2026-07-20
