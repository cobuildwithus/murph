# Qualify background wake hints before foreground handoff

Status: completed
Created: 2026-09-25
Updated: 2026-09-25

## Goal

- Keep background synchronization moving through redundant runtime wakes while
  preserving immediate, same-invocation admission of real foreground work.

## Success criteria

- An empty startup wake cannot leave imported device work unattempted.
- Fresh conversation work reuses its qualification fetch and enters the assistant
  without awaiting background completion or an avoidable checkpoint.
- Shutdown, blocked-assistant authority, due assistant work, and durable recording
  keep their existing owners and recovery behavior.

## Scope

- In scope: system-mailbox wake admission, composed regression tests, owner docs.
- Out of scope: new scheduling state, retry policy, transport timeout changes,
  provider behavior, model prompts, and production mutation.

## Constraints

- Reuse the existing bounded foreground prefetch and its handoff batch; no new
  dependency, queue, persisted state, or independently maintained classifier.
- Synthetic fixtures only. Preserve unrelated work in the primary checkout.

## Architecture and evidence

- The runtime owns foreground qualification; wake notifications are only hints.
  Current admission consumes a hint and returns before checking mailbox facts.
- Completion and checkpoint paths already qualify hints through the foreground
  prefetch owner. Reuse that owner before admitting or yielding mailbox work.
- Keep cancellation-before-qualification during snapshot construction: a real
  message must not wait for a large background snapshot.
- Wire and snapshot formats remain unchanged; mixed versions keep the existing
  authority contract, while older runtimes retain the bug until replaced.

## Product UX

- Outcome: background device updates finish despite redundant scheduler wakes.
- Reaches: quiet sync, a message racing startup or completion, due assistant work,
  blocked model access, and shutdown/recovery.
- Proof: composed runtime tests with durable mailbox readback, foreground admission
  ordering and fetch counts, plus existing checkpoint/preemption regressions.

## Risks and mitigations

1. Qualifying hints can add reads or delay foreground work. Reuse fetched batches,
   avoid reads without a hint, and assert one qualification fetch before admission.
2. Clearing a hint could lose a newer message or existing handoff authority. Keep
   authoritative checkpoint facts and test late arrivals and cancellation.

## Tasks

1. Add a failing startup-wake reproduction using the real runtime entrypoint.
2. Correct admission at the existing foreground qualification owner.
3. Verify empty-wake convergence, foreground latency boundaries, and type safety.
4. Review complexity/privacy, update owner documentation and changelog, and commit.

## Decisions

- Prefer extending existing qualification over a new wake wrapper or scheduler.

## Verification

- Focused assistant-runtime preemption, background-wake convergence, projection,
  checkpoint-wake and concurrent-device-import suites; package typecheck.
- Run the repository complexity guard and candidate diff review.
- Expected: redundant hints drain device work; real input retains foreground
  priority and same-invocation batch reuse. No model-behavior changes require a
  stochastic assistant proof.

## Evidence and outcome

- Reproduced the startup defect before the fix: each hint mode left device work
  unattempted. Fresh import and restored obligation fixtures now both drain.
- Runtime regression proof: 104 tests across startup, system preemption,
  background/projection convergence, checkpoint wakes, and concurrent device
  imports passed. Real input upgrades in the same invocation with one bounded
  conversation fetch and zero pre-admission background checkpoints; quiet device
  work performs zero admission qualification reads.
- Assistant-runtime and Web typechecks passed. Changelog generation and all 10
  archive rendering tests passed; content-only publication uses the existing
  archive presentation without renderer changes.
- Complexity guard passed: changed source debt 468 -> 468; maximum 223 -> 223.
  The existing runtime and system-work hotspots keep their ownership. Moving
  the completion qualifier to the shared lexical scope removes duplicate policy
  without introducing another state owner or extracting unrelated runtime code.
- Product UX: Ready for review. Empty hints keep device work moving; real input,
  due assistant work, blocked access, checkpoint cancellation, shutdown, and
  restored work retain focused coverage. No model/provider-input surface changed.
- Parent candidate review: source, composed proof, privacy, failure propagation,
  checkpoint authority, and fetch reuse reviewed. No private production rows or
  direct identifiers are included. No production mutation performed.
- Deployment: identical wire and snapshot shapes allow either binary to read the
  same state. Older runtimes retain the defect until ordinary runner rollout;
  rollback restores old behavior without a data migration. Command-start timeout
  and orchestrator timing policy remain outside this fix.

- Implementation and local proof complete in PR #3708. Required exact-head CI and
  external review are tracked on the PR before merge; deployment is separate.
Completed: 2026-09-25
