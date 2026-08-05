# Finite onboarding follow-up diagnostics

## Goal

Give unfinished onboarding three bounded daily opportunities while making every
schedule, execution, send, skip, and retirement decision explainable from
metadata-only hosted runtime logs.

## Proven failure shape

- Rollout reconciliation could transform an old active recurring record into a
  fresh follow-up opportunity instead of respecting its original lifecycle.
- The first candidate missed the exact deployed one-shot fingerprint, could
  expose a recurring source before its deferred cursor was durable, and could
  rehash an existing schedule through a different stable identity.
- In-turn lifecycle reads did not cover the later queued external-transport
  boundary.
- The first correction recognized predecessor definitions during managed
  reconciliation but not at cron or queued effect boundaries, so a failed
  reconciliation could leave an older record executable.
- The second correction made predecessors effect-ineligible but reused
  terminal skip/stale finalization, which could consume and archive the
  one-shot before managed reconciliation recovered it.
- The third correction preserved predecessor settlement by source identity,
  but hosted idle ordering could rewrite that source before draining its old
  queued intent and re-expose the generic consuming path.
- The fourth correction deferred that rewrite, but the hosted post-delivery
  owner did not re-read cron after authority-stale settlement. The retained
  occurrence could therefore lack a workspace wake, while direct threads could
  receive a misleading generic delivery-failure input for an intentional
  cancellation.
- Existing logs expose schedule and delivery mechanics but not the
  onboarding-state source or a stable lifecycle decision reason.

## Success criteria

- Open onboarding may receive at most one scheduled continuation on each of
  three local days, then the automation expires permanently.
- A send or skip consumes only that day's opportunity; it does not create work
  beyond the three-day window.
- Completed or declined onboarding retires the automation before delivery.
- Completion or unreadable state after queueing is revalidated by the existing
  outbox authority owner before external provider entry.
- Signup, rollout migration, and maintenance preserve one local minute and the
  original first occurrence through partial-write recovery.
- Existing active members are not granted an unbounded cadence during rollout.
- Every exact recognized predecessor is effect-ineligible until the existing
  reconciler durably produces the current finite definition, and failed
  reconciliation cannot consume its source or pending occurrence.
- Managed conversion defers while a predecessor runtime owns a pending delivery
  intent, allowing the existing outbox drain to settle the obsolete payload
  before the next managed pass rewrites the retained occurrence.
- Authority-stale predecessor settlement re-arms the retained cron retry for
  both direct-thread and participant delivery targets and does not stage a
  generic delivery-failure conversation.
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
