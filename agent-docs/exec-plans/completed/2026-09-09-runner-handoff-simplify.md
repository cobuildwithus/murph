# Simplify runner destruction and standby handoff

## Outcome and invariants

Reduce container handoff machinery while preserving one member-bound execution
owner, exact-generation cleanup, bounded failure, and durable retirement before
another target can be allocated. No new service, configuration, schema, or state.

## Owner and evidence

`RunnerContainer` owns native lifecycle operations; `UserRunner` owns target
reservation and the runtime write fence. The pinned Containers SDK delegates
`destroy()` directly to the native destruction promise. Cloudflare documents that
promise as completing when destruction finishes. The current adapter also polls
cached SDK status and races stop notifications, creating a redundant settlement
owner that can outlive native destruction. Prove this with synthetic stale-status
and delayed-native-completion cases before changing source.

## Changes and protected boundaries

- Delete the redundant destruction status poller and its observer bookkeeping.
- Await native destruction within the existing cleanup deadline; retain exact
  generation checks and fail closed on rejection or timeout.
- Keep pending-target reconciliation, immutable member binding, admission,
  readiness, and write-fence ownership at their existing boundaries.
- Reuse the retained-slot resolution receipt in fenced preparation. Remove
  binding readbacks after successful retirement in cleanup and bind recovery.
  Keep recovery reads for ambiguous failures and live callee authorization.
- Update lifecycle tests and the durable runtime and security owner documentation.
- No Web or Temporal wire changes. Old and new containers share existing RPCs
  and persisted records; no migration or rollout-order dependency is introduced.

## Product UX (Patch)

Outcome: a container handoff does not wait for stale status after native cleanup.
Reaches: fresh conversation startup, retained warm containers, and failure cleanup.
Proof: composed container/standby lifecycle tests for success, stale callbacks,
foreign ownership, destruction failure, and timeout. Deployed latency measurement
remains a post-deploy check; local evidence makes no end-to-end timing promise.

## Verification and completion

- Focused runner-container, standby, and real Containers SDK lifecycle tests.
- Cloudflare typecheck and complexity diff; inspect full diff for safety/privacy.
- Scoped commit, draft PR, candidate review, Ready, ReviewGPT alongside required CI.
- Record final proof and close this plan before handoff.

## Progress

Implementation and parent candidate review complete for the original lifecycle
scope; the network-call pass additionally removes three redundant binding RPCs. Removed destruction polling,
stop-observer bookkeeping, redundant synchronous guards, and a redundant error
wrapper. Native stopped-state checks avoid both cached status reads on retained
retirement. The stale-status regression failed before the source change and now
passes. No additional authority, persisted fields, services, or dependencies.

Focused proof: 235 runner-container tests, 50 standby tests, and seven pinned-SDK
tests pass. Cloudflare typecheck and complexity diff pass (complexity debt 75 to
69; existing unrelated hotspots unchanged). Ten changelog rendering tests pass.
Web typecheck passes. The network-call pass also passes 270 composed fleet,
consent, cleanup, and UserRunner tests; the final lifecycle/recovery run passes 359 tests. Cloudflare typecheck passes
after the final TypeScript edit. PR #3104 is open with complete evidence and a linked changelog entry.
ReviewGPT round 1 passed on `5ac681765e2320b2b2b0fd39f5f3ead638c702cc`.
The full-patch review took approximately six minutes in the Vonneumann lane.
The captured response hash matches its concrete `gpt-6-pro` model evidence and
committed user turn; the completion marker and all 14 patch blob hashes were
verified. The review covered native lifecycle, binding, consent, and deletion
owners and found no qualifying bugs or Complexity Collapse. No accepted
findings remain. The final documentation-only closure needs no new model round.

Initial CI passed the changed Cloudflare owner; an unchanged browser-vault UI
test timed out in the Web shard and passes in isolation on the same head.
Frog records the test-wait evidence without changing unrelated product code.
Final exact-head CI status is maintained on PR #3104 after this plan closure.

Product UX: Ready at the adapter boundary. Warm retention, native stopped-slot
retirement, immutable binding, delayed destroy, failed destroy, cleanup deadlines,
replacement generations, abort, and smoke paths are exercised. Live timing and
provider delivery are post-deploy proof, not claimed by these local tests.
Status: completed
Updated: 2026-09-09
Completed: 2026-09-09
