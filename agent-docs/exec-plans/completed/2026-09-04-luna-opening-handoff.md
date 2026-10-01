# Two-reply opening and background identity persistence

Status: completed
Created: 2026-09-04
Updated: 2026-09-05

## Goal

Keep the first two plain-text opening replies responsive, then let the normal
runtime continue onboarding while one bounded child saves supplied identity.

## Design

- Reuse the Web Luna reply, delivery ledger, encrypted mailbox, runtime import,
  existing warmup, and native one-shot children. Cap Web replies at two using
  existing delivery records; add no stage counter, queue, scheduler, or new
  preparation protocol.
- The second Web reply is eligible only after the confirmed canonical welcome
  in the same direct chat. Luna either asks bundled identity or yields the
  current request to the ordinary runtime. Preserve explicit skips and needs.
- The runtime's compact onboarding entry owns identity handling and the first
  aspiration question. The accepted input is the durable source for one child
  that saves identity through existing canonical commands. Root retains the
  existing early-check-in tool and proceeds without waiting for child writes.
- Keep deeper policy at its owning stage and remove duplicated opening rules.
- Preserve the existing delivery claim and external-reply suppression; replay
  reuses the same accepted reply. No speculative model session is needed for
  this bounded first experiment.

## Product UX

- Outcome: welcome, acceptance, identity, and aspiration discovery remain one
  continuous conversation with fewer serial actions on the identity turn.
- Reaches: fresh direct text onboarding, identity skips, immediate requests,
  returning-member ambiguity, replay and delayed delivery.
- Proof: deterministic cap/delivery/handoff tests, real Terra journeys with
  actual canonical identity readback, focused package tests and typechecks.
- Done when: at most two Web replies, no duplicate answer, next runtime question
  does not wait on identity persistence, saved facts converge, and the existing
  early check-in behavior remains intact.

## Tasks

1. Extend the existing instant reply owner through one bounded continuation.
2. Compact opening policy and delegate identity persistence with a local fallback.
3. Prove deterministic boundaries and repeated real-model opening sequences.
4. Review complexity, update product/architecture owners and changelog, commit,
   and finish PR evidence and required review/checks. Keep the PR draft while
   evidence is incomplete.

## Verification

Implemented in the existing PR worktree with no new persisted state, dependency,
queue, or speculative runtime turn. Parent scope, privacy, prompt, and Product UX
review completed for the opening behavior.

- Web: 278 focused owner, dispatch, and changelog tests pass; 9 archive rendering
  tests pass. Cap, concurrent claim, route change, replay after transcript
  advance, canonical tone, unavailable generation, and runtime fallback are covered.
- Assistant: 213 prompt, planning, asset, and ingestion assertions pass (7
  unrelated opt-in cases skipped). Web, Assistant Engine, and Contracts
  typechecks pass. Workspace boundaries, complexity ratchet, and diff checks pass.
- Live Luna: six synthetic acceptance/handoff cases passed with zero actions,
  using the captured production Web instructions and schema via local
  subscription. The Web provider-key lane was unavailable; this is semantic
  proof, not a measurement of the deployed Web HTTP path.
- Live Terra: real canonical memory commands, one native child, and the normal
  automation parser backed by real canonical saves prove the identity handoff.
  Two final-prompt runs returned the aspiration question in 21.794 and 21.071
  seconds. Both had one native child, one root automation action, zero policy
  reads, two canonical identity records, and exactly one saved check-in; all
  writes were verified at 56.297 and 39.566 seconds respectively. Earlier iterations
  showed why the existing host-rendered clock and supported localAt schema
  must replace redundant shell clock reads and the stale raw-at instruction.
- Prior-head probes measured 64.837 and 22.520 seconds. The latter verified
  identity records but missed the early check-in; the former failed that
  check before record assertions. These are not clean full-sequence production
  comparisons, and no latency SLA or net hosted speedup is claimed.
- The vague-returning ordinary-record fixture loaded later-stage guidance on
  main base, the prior PR head, and the candidate. This pre-existing routing
  failure remains visible; the original broad opt-in regression stays intact.
- Complete first provider input was captured through the pinned real App Server
  and local scripted Responses stub with identical fixtures. o200k_harmony:
  direct 26,835 to 27,955 tokens (+1,120), 124,475 to 129,993 UTF-8 bytes
  (+5,518); group unchanged at 22,056 tokens and 102,447 bytes. Only the direct
  assembled instruction message changes; tools and other input are identical
  after normalizing fixture paths and generated ids.

## Resumption and final review

- Continuation resumption found and reproduced an admission error: the second
  Web reply expected a self-owned thread-container route, while personal chats
  have no thread route. The correction supplies the existing direct-member
  resolution and preserves group vetoes, delivery cap, and final egress checks.
  The regression uses the real route reader with empty thread-route rows and
  exercises claim, generation, send, and outgoing mailbox append.
  Parent review also reproduced generation admission after consent withdrawal
  or inactive access. The existing AI-access decision now runs before history
  reads or new continuation generation; persisted replay recovery is preserved.
  After merging main, all 279 focused continuation, dispatch, direct-member
  target, and mailbox preparation tests pass. All 210 selected assistant prompt,
  planning, and asset tests pass (7 opt-in cases skipped). Web and Assistant
  Engine typechecks, complexity, and diff checks pass; workspace boundaries
  passed before the base merge.
- The final live identity journey passed again: reply at 19.743 seconds, all
  writes verified at 49.272 seconds, one native child, one root automation,
  two canonical identity records, zero policy reads, and no premature save
  claim. Subscription homes that failed cache preparation performed no actions;
  the first usable authorized home completed the journey.
- Complete provider-input measurement was repeated against main commit
  `0b897a8eb42447b82dc3cbaf82841f95f19df23e` with the same real App Server
  capture method. The updated numbers above preserve the +1,120-token direct
  delta; normalized group input is byte-for-byte identical.
- The original ReviewGPT response identified that error, but its capture failed
  model validation because the configured current-Pro alias disagreed with
  response metadata. Recovered exact-turn output is diagnostic evidence, not a
  passing final gate. Main now supplies ReviewGPT 0.5.145 and the supported
  gpt-6-pro target. Preserve the original reviewed-head lineage in the new full
  snapshot review.

- Pushed candidate `feae3ccbda2d4a80a90272faf8a8f07327baade1` received a
  validated full ReviewGPT PASS with gpt-6-pro in round 2. The response confirms
  the accepted direct-route finding and access correction are resolved; it
  identified no qualifying Critical/High bug or Complexity Collapse. Response
  hash: `f95d18f5ac65bcc4c5ea949d88825d7f10d2672ff32d6e8fefa8f2b108a0e7ba`.
  Parent final review agrees. The plan-close commit changes documentation only
  and is exempt from repeating the source review.
- PR #2802 is Ready with complete evidence. Exact-head CI remains a separate
  PR completion gate and is tracked in the PR; the final documentation commit
  must receive its own required checks. Current-base merge-tree proof passed.
  This closes implementation and source review; no merge or deploy is authorized.
- Full deployed opening-sequence timing with actual provider delivery remains
  unproven. The broader returning-member routing failure is independently
  reproducible on main and is not attributed to this change.
Completed: 2026-09-05
