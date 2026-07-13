# PR 567 Final Audit Round 2

## Goal

Close the two remaining exact-head ReviewGPT findings without adding another
phone-call status, recovery owner, or provider effect path.

## Outcomes

1. Any failure after Retell dispatch may have begun returns a typed durable
   `starting` or `failed` outcome with the call id.
2. Mandatory pointer-Workflow arming observes the existing 40-second aggregate
   web-owner abort signal before Retell can be called.

## Constraints

- Keep the existing `starting | calling | failed` response contract.
- Keep the pointer-only web Workflow as the only durable recovery mechanism.
- Preserve exact request-key idempotency and private-content boundaries.
- Do not add state, queues, schedulers, or dependencies.
- Do not signal the completed or future ReviewGPT process.

## Verification

- Focused service and Workflow fake-timer/error-path regressions.
- Focused internal-route/assistant boundary proof where existing harnesses fit.
- Full hosted-web tests, assistant phone-call tests, owner typechecks, lint,
  privacy/diff checks, exact-head CI, and one final exact-head ReviewGPT audit.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
