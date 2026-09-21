# Wait for requested delegated answers

Status: active
Created: 2026-09-21
Updated: 2026-09-21

## Outcome and scope

A requested delegated lookup returns its answer in the current conversation turn.
Onboarding continues asking questions while independent canonical saves run.
Reuse native Codex completion context and `wait_agent`; add no queue, wake,
state, tool, or delivery owner. Root retains sensitive reasoning and external actions.

## Evidence and decisions

The general prompt and hosted native hints prohibit waiting even when a member
explicitly requests delegation. Codex already queues child results and exposes
native waiting; waiting does not emit the forbidden interaction lifecycle event.
Narrow those instructions and preserve one-shot leaves and canonical readback.
A child failure must produce an honest answer or blocker, never a promised wake.
No deployed state or protocol changes; old runtimes keep their existing policy.

## Product UX

- Outcome: complete requested delegated answers without another member prompt.
- Reaches: private requested delegation and later requests needing an existing
  child's result; independent onboarding persistence remains nonblocking.
- Proof: composed prompt/config tests, real native delegated file lookup,
  existing real onboarding identity journey, focused typechecks and CI.
- Exclusions: automatic follow-up after a completed root turn and new group access.

## Tasks

1. Narrow general and hosted prompt hints; update the architecture owner.
2. Prove composed boundaries, native completion and onboarding continuity.
3. Measure provider input, review the diff, add release note, commit and open PR.
4. Run final ReviewGPT concurrently with exact-head CI and report results.

## Verification

Pending focused checks, real-model journeys, input measurement and final review.
