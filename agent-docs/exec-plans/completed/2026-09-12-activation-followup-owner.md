# Give foreground replies priority over onboarding follow-up setup

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Goal

Incoming conversations take priority when onboarding follow-up setup is already
running. One managed reconciliation owner creates and maintains the existing
finite follow-up; activation retains only onboarding start, route handoff, and
optional welcome responsibilities.

## Success criteria

- A synthetic message arriving during setup yields at the next completed durable
  unit, before remaining setup writes or welcome work. Foreground handling then
  runs and the original mailbox item resumes without losing its route or anchor.
- Silent direct signups still create a deliverable follow-up without another input.
- Delayed routes, completed/archived state, original next-day timing and cutoff,
  partial writes, retry, and restore retain their current product behavior.
- Focused tests and typechecks pass; a scoped PR is open with required CI and a
  resolved ReviewGPT loop on the intended candidate.

## Owner and evidence

The runner already observes foreground input. Activation receives no yield
callback, is absent from resumable mailbox actions, and awaits all seed writes.
Post-foreground member maintenance disables yielding. The existing cron author
publishes a temporary finite source, writes its occurrence cursor, then publishes
recurrence. Those are existing durable continuation boundaries.

Managed reconciliation already owns missing creation and closed-state handling.
The retained activation mailbox owns its accepted route and original activation
instant, so no new persisted route, enrollment flag, queue, or scheduler is needed.

## Scope and decisions

- Consolidate activation and maintenance follow-up lifecycle under the existing
  managed reconciler; delete activation seed orchestration and unused helpers.
- Thread foreground yielding through the existing mailbox and cron author. Finish
  an atomic write before yielding; never leave detached writes behind a reply.
- Preserve activation envelopes and their retry owner for silent signups. Do not
  delete required route fields or introduce a second durable handoff.
- Reuse existing preempted/pending mailbox results and managed retry scheduling.
- No provider prompt, tool schema, follow-up copy, audience, or consent changes.
  Deterministic ordering and persistence proof owns this patch; live model output
  is not needed unless implementation changes those model-facing contracts.

## Product UX

Effort: Patch.
Outcome: onboarding maintenance no longer chains remaining setup ahead of a reply.
Reaches: first and subsequent direct messages during setup; silent direct signup;
late Telegram route; completed or archived onboarding; retry and restored work.
Proof: real persisted cron readback and mailbox preemption/resumption, plus focused
foreground phase ordering. No production member data or delivery calls in fixtures.

## Failure and deployment

Keep the existing source/cursor write ordering and original time window. On yield,
the existing mailbox retains activation; on error its existing retry remains.
No envelope/schema migration is planned. Old and new runners must read the same
finite intermediate source and cursor. A running atomic operation can still delay
preemption until that bounded operation finishes.

## Tasks

1. Add faithful setup-yield and resume proof; confirm failure on the base.
2. Consolidate the follow-up owner, add safe yielding, and remove obsolete code.
3. Verify selected signup/foreground/retry/restore paths and typecheck owners.
4. Update architecture and member-visible changelog; review the complete diff.
5. Commit, push, open PR, run ReviewGPT concurrently with CI, resolve findings,
   close this plan, and verify final-head gates and mergeability.

## Verification

- Engine: 283 tests passed across cron runtime, managed automation core,
  onboarding follow-up policy, and recovery readiness. A source-write preemption
  regression failed on the base and passes with this change.
- Runtime: 336 tests passed across event handling, callback forwarding, system
  mailbox notifications, foreground phase, and activation integration. The noop
  activation result now consistently includes a null wake reason; its assertion
  was updated and the affected 14-test suite rerun successfully.
- Real Linq/email activation proof covers silent enrollment and a yield after the
  finite canonical source write. Restoring only persisted vault bytes then
  reconciling retains identity, direct route, original occurrence, and cutoff.
- A second foreground reply runs before post-reply activation resumes; yielded
  setup neither consumes its mailbox item nor sends the optional welcome.
- Engine and runtime typechecks pass. No provider prompt, tool, or model-visible
  input changes; no live provider generation is needed for these deterministic
  ordering and persistence assertions.
- Complexity guard passes. Common source fields and activation outcomes replace
  repeated construction. The existing cutoff helper now owns cutoff selection;
  its unreachable non-finite schedule fallback was deleted. Callback absence is
  normalized at repeatedly checked owner boundaries. No new durable owner.
- Architecture readback and docs drift pass. Web typecheck and all 10 changelog rendering tests pass; final PR
  CI remains a delivery gate. The changelog uses the existing archive component;
  content-only presentation proof follows the changelog owner's exception.

## Candidate review

The diff retains signed route validation, original enrollment anchoring,
closed-state handling, and finite-source/cursor/recurrence publication order.
Yielding waits for the current atomic write; it does not cancel or detach writes.
The runner's foreground flag can remain set for the invocation: pending mailbox
work may resume on the next idle invocation, through its existing liveness owner.
The change promises priority, not an absolute typing-time bound or immediate
post-reply setup completion. Broader workspace-phase refactoring is outside this
proven activation boundary. Product UX: Ready on local deterministic evidence.


## Review and handoff

PR: https://github.com/cobuildwithus/murph/pull/3381
Reviewed candidate: `1438bd4d7f98926bfab41c1176fcc7e8f8d39ef6`.

Round 1 completed with PASS: zero qualifying bugs or material complexity-collapse
findings, zero accepted findings, and no remediation or second round required.
The Vonneumann lane selected GPT-6 Pro; captured model metadata confirms
`gpt-6-pro` and binds the saved response hash to the exact accepted turn. Capture
completed after more than ten minutes, exceeding the three-minute minimum.
The response addresses the actual activation, source/cursor, route, retry,
restore, welcome, and callback paths and confirms the full snapshot metadata.
The original attachment was automatically removed after capture. Repackaging
metadata from the unchanged candidate/body confirms round 1, sensitive full
snapshot scope, 18 changed paths, the original head/anchor, and empty remediation
deltas. This was local metadata verification, not a second model request.

Parent final review agrees with the result. Production source has a net deletion
of 160 lines; no new persistent state or owner was introduced. Current-base
merge-tree is clean. Required CI is progressing; an initial Temporal status came
from a canceled hygiene run and has been superseded by pending proof after the
successful exact-head hygiene run. The final plan-only commit must pass its own
required CI before the PR task is reported complete. No merge or production
mutation is part of this PR-opening task. Keep the open PR worktree.
Completed: 2026-09-12
