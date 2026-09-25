# Remove retired runner reconciliation from fresh message admission

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

Complete normal container retirement and clear its exact user-runner assignment
before the next message, eliminating the old-target RPC from ordinary fresh
admission. Preserve exact-member execution fences and recovery from uncertain
or interrupted shutdown.

## Success criteria

- A fully stopped and retired idle target leaves no pending target for the next
  admission; a synthetic delayed old-target RPC is never invoked on that path.
- Warm retained targets remain reusable. Active fences, changed assignments,
  failed native stops, delayed callbacks, and missed notifications stay safe.
- Focused lifecycle, state, admission, and type checks pass. ReviewGPT audits the
  complete candidate with the retirement race and compatibility boundaries.
- Distinguish deterministic proof from any production latency measurement.

## Scope and owners

Cloudflare RunnerContainer owns native shutdown and immutable slot retirement.
UserRunner owns the exact pending assignment and execution fence. Reuse those
owners and existing state; add no scheduler, queue, or durable state table.
Container sizing, standby inventory, prompts, and model behavior are unchanged.

## Product UX

Outcome: shorter waits before a fresh conversation starts after idle shutdown.
Reaches: ordinary inbound messages, warm reuse, concurrent arrival during stop,
and shutdown recovery.
Proof: composed synthetic lifecycle-to-admission tests with a deliberately slow
old-target lookup, plus wrong-target, active-fence, and failed-stop cases.

## Investigation

Normal lifecycle cleanup currently destroys the native container but leaves its
slot binding and the user-runner pending assignment. Fresh admission therefore
contacts the old slot, resolves native liveness, retires it, and clears the
assignment before claiming prepared inventory. Existing per-phase telemetry
separates reconciliation from claim and binding, but does not split the old-slot
RPC internally.

## Approach and risks

1. Confirm stop ownership, retirement fencing, and completion callback ordering.
2. Retire only after a proven, generation-matched normal lifecycle stop.
3. Notify the existing user owner outside the lifecycle lock; clear only the
   exact retired target without deleting an active fence or replacement target.
4. Preserve existing next-admission reconciliation as recovery when notification
   is unavailable, delayed, rejected, or lost.
5. Add deterministic proofs, review the candidate, and run the requested final
   ReviewGPT audit alongside exact-head CI.

## Verification

Planned: focused Cloudflare lifecycle and user-runner admission tests, state-store
race tests, Cloudflare typecheck, documentation checks, and ReviewGPT review.
No live-model test is needed unless the implementation expands into assistant
interpretation or reply behavior; this change targets pre-execution allocation.

## Progress

- Isolated task checkout created; no other task checkout is being reused.
- Existing production timing and exact deployed source inspected read-only.
- Frozen workspace dependencies installed.
- Implemented post-stop durable retirement and verified background assignment clear.
- Remote verification stays outside the consent/admission lock; only the local
  conditional clear is serialized with new admission.
- Six focused suites passed (584 tests); ten retirement-focused tests also pass,
  including a message admitted while old-slot proof is delayed.
- Cloudflare typecheck and complexity guard pass. Existing complexity debt is
  unchanged; no modified function exceeds the threshold.
- PR #3338 opened as a draft. Changelog entry added; final ReviewGPT and CI pending.
- Production optimization is not deployed or benchmarked yet.

## Review and handoff

- Final ReviewGPT round 1 passed on `6a3c4002567cfddda1b651273b2d7a9bf53c6b80`.
- Full guarded snapshot; model attestation identifies GPT-6 Pro; response hash,
  exact accepted turn and completion marker verified. Review exceeded three minutes.
- Source-and-test review confirmed stop authority, generation checks, lock ordering,
  replacement assignment protection, and backward-compatible retirement fallback.
- No accepted findings remain. Local implementation and focused verification are complete.
- Changelog archive verification passed (10 tests). The documented invocation issue
  is recorded in the task Frog entry.
- Required CI, merge, publication, and production timing remain pending operations
  owned by the original task session; this completed implementation plan does not
  claim a production deployment or measured latency improvement.
Completed: 2026-09-11
