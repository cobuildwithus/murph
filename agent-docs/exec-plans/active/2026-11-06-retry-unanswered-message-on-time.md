# Retry an unanswered message on time instead of discarding it

Status: active
Created: 2026-11-06
Updated: 2026-11-06

## Goal

- A member message left pending by a failed turn is retried on time and is not discarded because a newer message was answered.

## Success criteria

- A pending input is no longer suppressed because a newer input in the chat has reply evidence.
- A retry that comes due during or just after a foreground turn reaches the existing checkpoint and continuation at its deadline, not after the conversation idle TTL.
- Foreground selection, hot reply path work, effect keys and persisted formats do not change.

## Scope

- In scope: deleting the `newer_message_answered` supersession path, capping the dirty checkpoint wait at a carried unserviced assistant wake when a member message is waiting, tests, owner docs.
- Out of scope: the 15-minute `too_old` rule, foreground selection, effect key scope, Codex signal handling, recovering already-suppressed messages.

## Constraints

- Technical constraints: no new scheduler, retry state, flag or schema. Keep the hot-wake provenance guard and wake identity. Voice checkpoints stay in place. Budget, shutdown and effect gates stay.
- Product/process constraints: the guarantee is prompt recovery of eligible pending work. The 15-minute cutoff remains an accepted loss boundary.

## Risks and mitigations

1. Risk: an older reply lands just after a newer one.
   Mitigation: accepted. On-time retry keeps the gap short, and the model can use the existing no-reply path.
2. Risk: a wake loop spins after an earlier checkpoint.
   Mitigation: preserve exact wake identity and the attempted-key guard.
3. Risk: an earlier checkpoint ends a live voice call.
   Mitigation: checkpoint in place, without an owner handoff.
4. Risk: a retry repeats an effect.
   Mitigation: unchanged from today. The input keeps its own keys. A reworded phone brief can still produce a new key, which is an existing limit.

## Tasks

1. Delete the supersession path and invert its test.
2. Cap the conversation quiet window at the carried assistant wake when input is pending.
3. Add timing, no-progress, voice and group tests.
4. Update the reliability owner doc.

## Decisions

- Cause, measured: two messages lost in 14 days. The input stayed pending with a retry scheduled, and stale cleanup discarded it 12 to 13 minutes later because a newer message had been answered.
- Superseded design: draft PR #4689 folded the older input into the newer turn. Reviews found five bugs in that logic, ending in a design flaw: folding moves phone and contact-share idempotency from the older input to the newer one.
- ReviewGPT architecture review, 2026-11-06, A-versus-B options: running the older input first needs a fixed admission scope, an attempt allowance and context rework, and still loses the message through the discard rule. Rejected as more complex.
- ReviewGPT architecture review, 2026-11-06, this design, outcomes:
  - Delete the supersession mechanism: accepted, verified that nothing else consumes it. It also suppressed input on another group member's answer.
  - Move the existing checkpoint deadline rather than add a loop: accepted. Must cover a wake due during the foreground turn and one due just after, and reach the background-work wait.
  - `too_old` stays as an explicit limit: accepted. Deleting it is a separate product decision.
  - Old runners keep discarding until drained, and existing suppressions are not reopened: accepted.
- Parent review of the implementation, 2026-11-06: `assistant` is the general wake reason (1,904 wakes for 179 members in 3 days), covering scheduled work as well as retries. Capping on the reason alone would end warm conversations early on routine work. The cap now requires a pending member message, using the existing `inspectHostedPendingAssistantInputWakeCandidate`, off the reply path. Unknown pending state keeps the quiet window. The existing collapse tests stay unmodified apart from pinning "no message waiting" in their fixture.
- ReviewGPT PR round 1, 2026-11-06, one High, accepted: the deadline also overrode the background-work hold, so a retry could checkpoint and end the runner while an image was generating, aborting it after the member was told it was coming. The suggested fix kept the image controller alive across the checkpoint. A smaller fix was taken: the cap touches only the quiet window, and the background hold is back to its `main` form. This supersedes the architecture review's advice to carry the deadline into that hold. A retry waits for active background work, then checkpoints at once.
- Codex deep review, 2026-11-06, one P2, rejected with wording fixed: a pending system delivery-failure note also counts as pending, so it can shorten the quiet window. That note is itself waiting work, the harm is one earlier checkpoint in a rare case, and excluding it would need a second inspection variant. Docs now say pending input rather than member message. Spin, voice, effect order, compaction and batching were traced with no other defects.

## Verification

- Commands to run: focused `packages/assistant-runtime` and `packages/assistant-engine` tests, `pnpm typecheck`, `pnpm complexity:diff`, `pnpm docs:drift`.
- Expected outcomes: the inverted discard test and the new timing tests fail on `main` and pass here; existing wake-gate, voice, no-progress and evidence regressions stay green.
