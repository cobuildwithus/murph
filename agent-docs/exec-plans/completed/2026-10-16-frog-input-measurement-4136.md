# Restore complete baseline provider-input measurement

Status: completed
Created: 2026-10-16
Updated: 2026-10-16

## Goal and invariant

Frog #4136: compare the selected base and current assistant inputs without
mixing relative prompt/tool dependencies or requiring a previous PR's enum delta.
Production behavior and review gates remain unchanged.

## Owner and cause

The opt-in assistant-engine measurement test copied only three source files;
relative imports resolved to current modules. Its groupAvailable fixture also
selected current prompt/config in both phases and asserted a particular enum
addition. The actual owner is test support, not assistant production code.

## Scope and decisions

Use one disposable Git archive of assistant-engine source, preserving relative
imports. Reuse the candidate request adapter, public workspace dependencies, Codex and model catalog;
report that boundary explicitly. Select base instructions, prompt, tools and
native delegation text for every fixture. Remove obsolete enum-delta assertions,
retaining registered-versus-visible tool contract checks. Use one workspace per
base/head pair. Do not change the independent weekly benchmark.

No new durable state, runtime owner, deployment or external effect. Snapshots
have unique directories and bounded archive commands, with owned cleanup.

## Verification

- Deterministic snapshot regression: changed transitive prompt/tool imports,
  deleted base-only module, distinct snapshots and failure cleanup.
- Credential-free complete-provider captures: current base control and a
  historical prompt-module change for direct, shared-read and full group cases.
- Focused package typecheck, complexity and documentation checks.
- Exact-head ReviewGPT and required PR CI before authorized low-risk merge.

## Related verified report

Frog #4137's stale live assertion was fixed in commit 0a28c429319a7ebe9dcb86ff7d7557b1191b2902,
merged by PR #4129 as e9ff20f5e4a634a4aba4d14a44b99f879b96efa3. Verify the
current journey before its separate already-fixed closure; no duplicate patch.

## Results

- Original groupAvailable control fails the prior-PR enum assertion against
  current main. Candidate snapshot/transitive-import regression and complete
  group-tool suite pass (115 tests).
- Candidate complete-request captures pass for all three fixtures against
  current main with zero byte delta (179562 direct, 155434 shared-read group,
  164448 full group). Historical base `0a28c429^` also passes all three with
  respective deltas +1631, +1566 and +1589 bytes. No tokenizer is configured;
  no token estimate substitutes for that unavailable measurement.
- Assistant-engine typecheck, complexity guard and docs drift pass. Complexity
  reports no authored runtime source changes; all executable changes are tests.
- Current focused live missing-data journey passes through local subscription
  on gpt-6.1-sol: one provider request, exact host shared-read arguments, no
  schedule mutation, truthful concise reply. Reply review: Ready. This verifies
  the already-merged #4137 fix; its closure is sequenced by the coordinator.
- ReviewGPT and required exact-head CI remain PR gates. The implementation is
  test-only and eligible for autonomous merge once those gates pass.
Completed: 2026-10-16
