# Two-reply opening and background identity persistence

Status: active
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
  direct 26,742 to 27,862 tokens (+1,120), 124,070 to 129,588 UTF-8 bytes
  (+5,518); group unchanged at 22,008 tokens and 102,259 bytes. Only the direct
  assembled instruction message changes; tools and other input are identical
  after normalizing fixture paths and generated ids.

## Remaining PR gates

- Continuation resumption found and reproduced an admission error: the second
  Web reply expected a self-owned thread-container route, while personal chats
  have no thread route. The correction supplies the existing direct-member
  resolution and preserves group vetoes, delivery cap, and final egress checks.
  The regression uses the real route reader with empty thread-route rows and
  exercises claim, generation, send, and outgoing mailbox append.
  All 280 focused continuation, dispatch, direct-member target, and mailbox
  preparation tests pass. Web typecheck, workspace boundaries, complexity,
  and diff checks pass. Existing live prompt evidence is unchanged.
- The original ReviewGPT response identified that error, but its capture failed
  model validation because the configured current-Pro alias disagreed with
  response metadata. Recovered exact-turn output is diagnostic evidence, not a
  passing final gate. Preserve the original reviewed-head lineage when sending
  the corrected full snapshot with a supported explicit Pro target.

- Push the scoped candidate, update PR evidence, and run the required
  cross-cutting ReviewGPT/CI gates. PR remains draft; no merge is authorized.
- Full deployed opening-sequence timing with actual provider delivery remains
  unproven. The broader returning-member routing failure is independently
  reproducible on main and is not attributed to this change.
