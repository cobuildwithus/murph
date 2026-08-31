# Converge canonical system mailbox progress

Status: completed
Created: 2026-08-31
Updated: 2026-08-31

## Goal

- Stop repeated no-op hosted runtime admissions by publishing restored local
  system-mailbox progress when it is monotonically ahead of Web's canonical
  workspace projection.

## Success criteria

- A zero-row `system_mailbox` import checkpoints once when restored local
  handled-through progress is ahead of canonical workspace status.
- The checkpoint uses the existing workspace CAS/checkpoint owner and publishes
  the locally derived imported and handled-through frontiers.
- Equal or canonically newer progress does not create another checkpoint.
- Focused runtime regression coverage and the assistant-runtime typecheck pass.
- Exact-head PR review, required CI, merge, deployment, and bounded production
  aggregate proof complete without a new warning/error shift.

## Scope

- In scope: hosted runtime system-mailbox checkpoint admission, focused
  regression coverage, and the matching hosted-runtime protocol invariant.
- Out of scope: Temporal backoff policy, device provider scheduling, mailbox
  schema changes, manual production data repair, and the separate Linq canary
  checkpoint race.

## Constraints

- Technical constraints: preserve Web as canonical workspace projection owner,
  runtime as local progress/checkpoint owner, monotonic cursors, existing CAS,
  foreground priority, and bounded database load.
- Product/process constraints: make the smallest owner-local correction; add no
  queue, scheduler, retry owner, persisted field, compatibility shim, or
  provider call.

## Risks and mitigations

1. Risk: stale local state could regress a newer canonical projection.
   Mitigation: admit convergence only when both parsed local frontiers are at
   least canonical and one is strictly greater; equal, lower, crossed, missing,
   or malformed values do nothing.
2. Risk: generic no-op imports could create a checkpoint loop.
   Mitigation: scope the gate to system-mailbox mode and prove the aligned
   second pass performs no checkpoint.
3. Risk: a convergence checkpoint could erase a real future wake.
   Mitigation: reuse the existing system-mode wake resolver and checkpoint
   builder rather than constructing status or wake state separately.

## Tasks

1. Add a focused failing regression for a restored local handled-through cursor
   ahead of Web status with an empty mailbox fetch.
2. Add one monotonic local-vs-canonical convergence predicate to the existing
   system-mode checkpoint-pending decision.
3. Document the owner-local self-healing rule and run focused tests, typecheck,
   and diff/privacy review.
4. Commit and push the exact candidate, run preliminary and final ReviewGPT
   gates with required CI, resolve accepted findings, and merge.
5. Deploy through the protected public runtime path and compare bounded
   production aggregates for invocations and Vercel reconciliation traffic.

## Decisions

- Repair the divergence at the existing runtime checkpoint owner. Temporal only
  observes canonical Web facts and must not infer or mutate runtime-local
  progress.
- Derive the repair from existing local mailbox state; introduce no new state.

## Product UX

- Effort: Patch.
- Affected person: an existing member with a retained device-sync wake whose
  runtime already finished the work but whose last Web checkpoint was missed.
- Expected experience: the invisible recovery work converges once instead of
  repeatedly consuming shared runtime and Web capacity; real foreground and
  scheduled work keep their existing ordering.
- Recovery: a failed convergence checkpoint remains retryable through the
  existing durable wake and CAS path; no work or connection is cleared to hide
  the traffic.

## Verification

- Run the focused system-mailbox entrypoint regression and the whole owning test
  file while iterating.
- Run the assistant-runtime package typecheck and repository diff checks.
- Require exact-head GitHub Actions and both routed ReviewGPT stages before
  merge.
- After deployment, compare equal bounded windows: no-op system-mailbox attempts
  and `/reconciliation-facts` traffic should collapse after one convergence
  checkpoint per affected runtime, with no warning/error increase.

## Results

- Reused the existing system-mailbox checkpoint when restored local imported
  and handled-through progress componentwise dominates canonical progress.
- Added fixed-boolean phase telemetry on the existing checkpoint log so the
  repair can be proven without logging cursors or creating another log row.
- Proved one repair checkpoint and subsequent quiescence, plus fail-closed
  equal, canonical-ahead, crossed, missing, and malformed cases.
- Verified the complete 50-test system-mailbox owner file, assistant-runtime
  typecheck, changelog rendering test, Web typecheck, and diff/privacy checks.
Completed: 2026-08-31
