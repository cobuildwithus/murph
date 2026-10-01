# Environment Queue Starvation

Status: completed
Updated: 2026-08-26

## Outcome And Invariant

An accepted Environment interview must update the canonical Environment report
after any already-running foreground turn reaches a safe handoff. Foreground
replies keep priority, accepted mailbox rows stay durable and ordered, and the
fix must not add another scheduler, queue, state owner, or polling loop.

## Proven Gap

- Aggregate production evidence showed a set of accepted Environment interview
  items remain durably queued but unhandled for tens of minutes.
- The delay overlapped long-lived `default` runtime invocations while normal
  conversation work continued.
- Cloudflare runtime arbitration can replace selected maintenance owners with
  `environment_interview`, but an active `default` invocation returns busy and
  retains ownership indefinitely from the Environment request's point of view.
- Existing Environment execution tests cover an idle runner, not an interview
  accepted while `default` is active.
- The public reconciliation owner computes
  `environmentInterviewPending`, but the deployed wire projector omitted it.
  The private Temporal worker therefore could not select the existing dedicated
  Environment mode and treated the item as generic system-mailbox work, which
  cannot apply Habitat answers.
- The reverse mismatch was also incomplete: fresh foreground work behind an
  active Environment invocation performed only a liveness check, so background
  publication could retain the execution fence instead of yielding foreground
  authority.

## Product UX Patch

- Outcome: an accepted Environment interview reaches the existing report
  without an unbounded wait behind unrelated hosted work.
- Reaches: the existing Web Environment interview save and recovery journey.
- Proof: a production-shaped contention test finishes the current foreground
  boundary, executes the queued Environment owner, refreshes Browser Vault, and
  clears the durable processing frontier.

## Plan

1. Trace the current Web, Temporal, Cloudflare, runtime, and checkpoint owners
   and separate foreground work from background continuation work. Completed.
2. Add contention regressions in both directions: Environment behind active
   `default`, and fresh foreground behind active `environment_interview`.
   Completed.
3. Keep the exact active child as the sole handoff owner: wake it, preserve its
   fence through checkpoint publication, then let ordinary reconciliation admit
   the waiting mode. Completed.
4. Publish the existing Environment-pending fact on the Web reconciliation
   wire so Temporal can select the dedicated mode without a cross-repository
   source import. Completed.
5. Prepare the private Temporal worker behind a replay-safe patch marker and
   run focused plus production-shaped full-stack proof against the public
   candidate. Completed.
6. Run exact-head specialist and final review on the public candidate and
   resolve accepted findings. Completed.

## Operational Follow-through

- Require green exact-head public CI, then merge the public PR.
- Cut the next shared public package release from merged `main` and replace the
  private proof-only sibling link with that exact registry version.
- Review and merge the private Temporal PR, deploy public runtime surfaces
  before the private worker begins selecting the new mode, and prove both
  contention directions in production.

## Deployment

Release the public hosted-execution package before deploying the private
Temporal worker that consumes its required reconciliation fact and processing
mode. The Web wire may deploy before that worker because old workers ignore the
additive field. The Cloudflare controller/runner handoff may deploy before or
after the new Temporal worker because both mismatch paths preserve the exact
active fence and retry through existing reconciliation; no component invents a
second owner.

Post-deploy, verify both directions: a contended Environment item runs under the
dedicated owner after the foreground checkpoint and refreshes Browser Vault,
while a fresh foreground inbound wakes an active Environment owner, receives
provider authority before the Environment publication advances, and then lets
the pending report converge.

## Verification

- Controller regression was red before the fix because the active default
  child was never woken; it now passes and proves no abort or duplicate start.
- Runtime regression was red before the fix because default mode continued
  after checkpoint; it now proves one foreground pass, one checkpoint, an
  immediate recheck, and no Environment import under the default owner.
- Current-main Cloudflare ownership regressions pass 6/6, and the split
  assistant-runtime Environment ownership regressions pass 3/3.
- Cloudflare, assistant-runtime, hosted Web, and hosted-execution package
  typechecks pass.
- Hosted-execution contract tests pass 40/40; the focused Web reconciliation
  projection tests pass 2/2.
- A production-shaped public Web/Cloudflare/runner plus private Temporal
  full-stack scenario proves the exact fence and final Browser Vault frontier
  in both handoff directions.
- Final ReviewGPT round 1 returned `PASS` on the exact pushed implementation
  head. The preliminary specialist found two stale omitted-field assertions;
  its test-only patch was independently reproduced, inspected, and applied.
  The Temporal producer fixture passes 2/2. The Web boundary test's dynamic
  route import remained blocked by its pre-existing 60-second hook limit before
  reaching the corrected assertion, so exact-head Web CI owns that broad proof.
- The broad local repo-tools run stalled with an idle Vitest worker and no
  failure output; it was stopped only after exact current-session process-tree
  ownership was proven. Exact-head Host Support CI owns the broad lane.
- The required changelog fragment is privacy-safe and reuses the existing
  archive; the prepared Web typecheck passes.
- Live desktop/phone changelog inspection is blocked because this session has
  no attached in-app browser; the existing archive/page render contracts are
  covered by the focused test set, and the PR will link the preview route for
  reviewer inspection.
Completed: 2026-08-26
