# Wait for requested delegated answers

Status: completed
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

- 26 composed prompt/thread tests and 54 hosted config tests pass (7 opt-in skipped).
- Assistant-engine, assistant-runtime, and Web typechecks pass.
- Both focused real-Codex journeys pass on gpt-5.6-terra via local subscription:
  one child returns the lookup answer before the root ends, without duplicate
  root reads; onboarding asks the next question before its child finishes,
  with one check-in and canonical identity readback. UX: Ready.
- Native checkpoint background-work validation passes after requested waiting.
- Changelog production rendering: 10 tests pass. Complexity ratchet passes;
  existing routing/config hotspots do not change.
- Complete provider requests captured with native hosted delegation hints:
  private 139,369 -> 140,246 bytes; group 118,688 -> 118,993 bytes
  after normalizing generated identities and synthetic workspace paths.
  Exact Terra tokenizer unavailable. gpt-tokenizer 3.4.0 o200k_base estimates:
  private 29,810 -> 29,966 (+156, +0.523%); group 25,810 -> 25,863
  (+53, +0.205%). These are not exact target-model token counts.
- PR #3642 opened as draft. Final ReviewGPT and exact-head CI remain external
  PR gates; no merge or deployment is included.
Completed: 2026-09-21
