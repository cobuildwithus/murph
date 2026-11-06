# Recap chat result

## Outcome and ownership

The group message announces the finished game and canonical score, then one
specific moment, before the existing recap link. The shared recap prompt and
Web validator remain the owners; no new state, schema, queue or dependency.
The old prompt explicitly forbids the result and requests a redundant CTA.

## Product UX

- Outcome: both players understand the end and result without opening the recap.
- Entry and promise: settlement queues the existing recap turn and saved message.
- Affected people: tied players, winner and loser, and returning pairs with lore.
- Proof: deterministic canonical-score/originality cases, synthetic real-model
  journey, six g32 and two g31 external eval samples; no member messages.
- Done when: correct result then a specific moment, under 160 characters, no CTA.

## Implementation and verification

1. Rewrite only the chatLine prompt bullet and update existing prompt proof.
2. Validate score pairs against canonical scores; exempt only the opening result
   clause from originality, retaining checks on the specific moment.
3. Keep external eval prompt/checks aligned; preserve original fixtures.
4. Focused tests, typechecks/lint, live journey, parent review, ReviewGPT and
   exact-head CI. Merge then follow the existing Web/runtime deploy path.

## Compatibility and privacy

No serialized shape changes. Old/no-score chat lines remain accepted on replay.
Web supplies queued instructions; prompt and validator ship together. Runtime
rollout follows merge as authorized. Private eval names remain outside the repo;
public evidence uses neutral placeholders. No production data or member sends.

## Evidence

- Ready: 55 focused Web tests and 8 hosted prompt tests pass. Web, hosted-execution
  and assistant-engine typechecks pass; Web lint passes with existing warnings.
- Complexity guard passes with no changed-file hotspots; diff reviewed for
  scope, canonical result wiring, replay preservation and privacy.
- Two focused real-Codex subscription journeys on gpt-6.1-sol pass (winner and
  tie). Each performs read_game, one accepted write and one queued delivery,
  with the canonical result first and no duplicate invitation.
- Eight external v10 samples (six g32, two g31) all save on their first write,
  span 69–103 characters, state the canonical tie and omit CTA/link. All samples
  revalidate with the aligned harness. Original fixtures are unchanged. Private
  names remain external; the PR contains each line with neutral placeholders.
- A scripted native-provider capture measured individual input at 167088 bytes
  before/after; representative group input with recap instructions at 150049 to
  150151 bytes (+102, +0.068%). Tools unchanged. Exact Sol token counts unavailable.
- No task-owned repository friction entry was needed. The live runner's explicit
  single-journey guard was satisfied by selecting each exact scenario.
- Candidate is ready for the authorized ReviewGPT/CI/merge and deploy gates.

Status: completed
Updated: 2026-11-01
Completed: 2026-11-01
