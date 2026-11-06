# Recover unanswered member input in the next turn

Status: active
Created: 2026-11-06
Updated: 2026-11-06

## Goal

- A member message that a turn failed to answer is answered by the member's next turn in that conversation, instead of being discarded by stale cleanup after the follow-up is answered alone.

## Success criteria

- A pending, unanswered, adjacent member input and a fresh follow-up produce one provider turn that admits both input ids, with reply coverage and terminal evidence for both.
- The same holds after workspace restore when no failed-turn receipt exists.
- Fresh input is never delayed by recovery. When an older input cannot join, the fresh input is answered as it is today.
- Foreground discovery stays bounded and recovery is resolved once per invocation.

## Scope

- In scope: foreground input selection, passing that one selection through batch accounting and automation, tests, owner docs.
- Out of scope: the 15-minute `too_old` rule, the `newer_message_answered` rule, Codex signal handling, persisted hint fields, schema changes, and inherited-retry wake timing, which is the separate follow-up below.

## Constraints

- Technical constraints: reuse `shouldGroupAdjacentAssistantInputCandidates`, the existing batch selector, accepted-input scope, terminal evidence and mailbox acknowledgment. No new retry state, queue or failure flag. Preserve original input ids and timestamps. Acknowledge nothing at selection time.
- Product/process constraints: a late reply must not land out of order. The guarantee is bounded: eligible unresolved input is included in the next compatible turn, subject to existing terminal non-reply and expiry policies.

## Risks and mitigations

1. Risk: pending state also holds terminal, unacknowledged input.
   Mitigation: exclude input with complete terminal evidence and keep partial-evidence repair in the engine.
2. Risk: foreground latency and coupling to unrelated pending backlog.
   Mitigation: bounded read-only inspection, resolved once and passed forward; unknown or exhausted inspection falls back to fresh-only.
3. Risk: retry repeats effects from a turn whose actions already ran.
   Mitigation: same exposure as today's retry, which ignores action counts. Effect owners keep their own idempotency. No "safe to retry" flag.
4. Risk: restored input joins across an authority boundary.
   Mitigation: conversation-lane adjacency plus the existing grouping predicate decide membership, not the stale-cleanup chat key.

## Tasks

1. Add failing tests for the adjacent-input and restore cases.
2. Implement one bounded recovery selection and carry it through `workspace-runner.ts` and `maintenance.ts`.
3. Keep the existing grouping, reaction, route, cap, and cardinality regressions green.
4. Update the reliability owner doc.
5. Follow-up PR: inherited retry that becomes due during a replacement foreground turn.

## Decisions

- Cause, measured on production logs: two messages lost in 14 days, both `process_exit` with 0 observed actions, during rollouts. The input stayed pending; the follow-up was selected fresh-only and answered alone; stale cleanup then dropped the older input as `newer_message_answered` 12 to 13 minutes later.
- ReviewGPT architecture review, 2026-11-06, outcomes:
  - Recover the unanswered cohort with existing authority, not raw same-chat pending ids: accepted, verified against `turn-input.ts` and `grouping.ts`.
  - Keep `too_old` and `newer_message_answered`, and state a bounded guarantee: accepted. Both stay reachable through old runners and cohorts that cannot be folded.
  - Foreground adds I/O, and selection runs twice: accepted, verified at `workspace-runner.ts:1001` and `maintenance.ts:364`, guarded by `hosted-hot-reply-state-cardinality.test.ts`.
  - Do not gate on `providerActionCount`: accepted. A zero count does not prove zero effects.
  - Inherited retry delay: accepted as a separate follow-up. It touches the wake loop, has spin and voice-session risks, and did not cause the measured loss on its own.
  - Hold fresh input when an older cohort cannot join: rejected. Fresh input is never delayed; this is a documented exception.
  - Keep Codex alive through the drain: deferred. The loss is fixed without it and the trigger is unproven.
  - Trigger diagnostic: deferred. A parent-side log cannot tell a handled signal from stdin EOF.
- Codex deep review of the implementation, 2026-11-06, outcomes, all verified against the code and accepted:
  - Fresh input was displaced at the 50-input cap: an over-cap cohort now stays fresh-only. This replaces the review's oldest-first service, because fresh input is never delayed.
  - Partial terminal evidence could defer the whole group at `reply.ts`, blocking fresh input: any terminal evidence now excludes an input.
  - The replyability filter read automation state, which can write or quarantine it: foreground recovery now checks replyability against the fresh input's channel.

## Verification

- Commands to run: focused `packages/assistant-runtime` and `packages/assistant-engine` tests, the state-cardinality test, `pnpm typecheck`, `pnpm complexity:diff`, `pnpm docs:drift`.
- Expected outcomes: the new tests fail on `main` and pass here; existing grouping, reaction, route, cap and cardinality regressions stay green.
