# Finite onboarding follow-up diagnostics

## Goal

Give unfinished onboarding three bounded daily opportunities while making every
schedule, execution, send, skip, and retirement decision explainable from
metadata-only hosted runtime logs.

## Proven failure shape

- Rollout reconciliation could transform an old active recurring record into a
  fresh follow-up opportunity instead of respecting its original lifecycle.
- Existing logs expose schedule and delivery mechanics but not the
  onboarding-state source or a stable lifecycle decision reason.

## Success criteria

- Open onboarding may receive at most one scheduled continuation on each of
  three local days, then the automation expires permanently.
- A send or skip consumes only that day's opportunity; it does not create work
  beyond the three-day window.
- Completed or declined onboarding retires the automation before delivery.
- Existing active members are not granted an unbounded cadence during rollout.
- Logs identify the managed automation, onboarding-state status and source,
  lifecycle action, execution outcome, and safe reason code without member
  identity, transcript text, health data, delivery targets, or local paths.
- No new scheduler, queue, persisted lifecycle owner, or billing coupling is
  introduced.

## Implementation

1. Map the existing automation scheduler, run receipts, onboarding-state read,
   and hosted structured-log boundaries.
2. Represent the three opportunities with the existing recurring schedule and
   a fixed local-calendar expiry.
3. Add metadata-only lifecycle and execution decision events at the current
   runtime owner.
4. Add focused regression coverage for fresh, migrated, completed, skipped,
   sent, and expired behavior.
5. Update the onboarding and runtime observability contracts.
6. Run focused tests and typecheck, then complete the required exact-head PR,
   ReviewGPT, and CI workflow.

## Verification

- Focused assistant-engine tests prove three local-day opportunities and the
  hard terminal boundary.
- Focused runtime/logging tests prove stable decision fields and reject private
  payloads.
- Package typecheck passes for every touched runtime package.
- Candidate review confirms the diff does not add a state owner or expose
  member data.
