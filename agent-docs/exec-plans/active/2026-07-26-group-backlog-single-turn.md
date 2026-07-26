# Coalesce released group backlogs into one assistant turn

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- When a blocked group room is released, process its adjacent causal backlog as
  a catch-up sequence that can commit at most one reply instead of replying
  once per participant or native reply anchor.
- Preserve direct-message boundaries, affirmative-reaction trust boundaries,
  group actor authority, native reply context, causal ordering, and
  separate-thread isolation.

## Success criteria

- A pending hosted group input received before a later sent auto-reply turn
  began in that exact room is terminally suppressed without another provider
  request.
- A pending hosted group input older than a later active auto-reply intent in
  that exact room defers without advancing until delivery becomes sent or
  terminally fails.
- The automation scan stops after committing the first hosted Linq group reply
  and schedules a fresh pass before another actor/reply-anchor group can enter
  the provider against a stale shared history snapshot.
- Failed or abandoned reply intents do not suppress later pending work.
- Direct messages, other rooms/accounts/channels, local automation, and group
  input received during or after the prior reply turn remain replyable.
- Participant and native reply-anchor boundaries remain unchanged.
- Focused regression tests, the canonical diff test dispatcher, typecheck, and
  acceptance verification pass.
- Product-experience review and the required preliminary/final ReviewGPT gates
  find no unresolved correctness, privacy, reliability, or coverage issue.

## Scope

- In scope:
  - hosted group-backlog overtaking against canonical local outbox intent state
  - regression tests for sent, active, failed, direct, newer-input, and
    separate-room boundaries
  - durable runtime/architecture documentation
- Out of scope:
  - changing usage limits, reset accounting, or the `/ops/usage` interface
  - adding a queue, scheduler, cooldown, or new persisted recovery state
  - changing direct-message reply semantics
  - replaying or editing already-delivered production messages

## Constraints

- Technical constraints:
  - use existing auto-reply outbox intent, turn receipt, and terminal
    suppression evidence
  - match exact group account/channel/thread while deliberately ignoring actor
    only for room-level overtaking, never for provider or tool authority
  - do not weaken actor-scoped admission, native reply context, explicit
    reply/reaction authorization, or route authority
- Product/process constraints:
  - preserve the product-critical current-inbound reply flow
  - keep production evidence aggregate and redacted
  - coordinate narrowly with the active mailbox consumed-at work, which also
    advertises broad assistant-runtime ownership

## Risks and mitigations

1. Risk: a queued reply that later fails could incorrectly silence pending
   input.
   Mitigation: active intents defer rather than suppress; only sent intent
   truth writes terminal suppression, while failed/abandoned intents unblock
   the next input.
2. Risk: room-level overtaking could cross a DM, account, channel, thread, or
   silence genuinely new input that arrived while the first reply was running.
   Mitigation: require hosted execution, a non-direct input, hosted answered
   mailbox evidence, exact account/source/thread/directness matching, and
   pre-turn receive time; cover negative cases.
3. Risk: provider or group-tool authority could broaden across participants.
   Mitigation: leave actor-scoped batching, active admission, reply anchors,
   and provider turn construction unchanged.
4. Risk: an active mailbox refactor overlaps the hosted runtime folder.
   Mitigation: limit runtime edits to the turn-input grouping call site and its
   focused tests, inspect the final diff, and avoid mailbox persistence or
   consumed-at symbols.

## Tasks

1. Record aggregate production evidence for the reset-to-burst path.
2. Add a pre-provider hosted group overtaking decision derived from current
   outbox intent state.
3. Stop and freshly continue the shared-history scan after the first group
   reply intent; write sent-overtaken inputs as existing terminal suppression
   evidence; defer behind active delivery; ignore failed/abandoned intents.
4. Add engine regression tests for the positive and negative boundaries.
5. Update the runtime owner documentation.
6. Run focused checks, canonical diff/acceptance verification, product review,
   preliminary ReviewGPT, final review, CI, and the final ReviewGPT gate.

## Decisions

- Production aggregate evidence for the incident window showed one group
  container issuing 14 distinct provider turns and 11 accepted deliveries in
  roughly two and a half minutes after usage resumed. Twelve selected batches
  contained one input; the other two contained two and three. All selected
  inputs were Linq messages with native reply anchors.
- Participant and native reply-anchor fragmentation is intentional: it keeps
  participant identity authority and prior-message context from crossing a
  provider turn.
- The root cause is a missing group-room overtaking invariant. A later sent
  auto-reply does not currently retire older pending group inputs, so
  reconciliation keeps opening authorized turns and delivering each result.
- The scanner also shares one cached outbox snapshot across every group in a
  pass, so a guard based only on persisted intent truth must stop after the
  first commit and continue with a fresh snapshot instead of admitting the rest
  of that pass.
- Derive overtaking from the existing outbox, turn-receipt, and
  terminal-evidence owners. Use the prior turn start as the backlog frontier so
  input received while that reply was running remains replyable. Do not add a
  reset-specific purge, cooldown, queue, or second recovery state.
- Architecture pressure check: the correction adds no persisted state, schema,
  dependency, service, queue, manager, or reset-specific branch. It reuses the
  existing scanner stop/`nextWakeAt`, outbox intent, turn receipt, and terminal
  suppression owners. A fresh scan is simpler than adding cache invalidation or
  a second in-pass room state machine.

## Verification

- Completed:
  - focused assistant-engine automation runtime suite: 174/174 tests passed
  - assistant-engine owner typecheck: passed
  - scanner-level two-actor queue-only regression: passed with one provider
    call, one intent, a continuation wake, and the cursor at the first group
  - product-experience review: `NO FINDINGS` after the parent fixed its
    acknowledgement-race and stale-history findings
  - diff privacy scan and `git diff --check`: passed
  - rebased `pnpm test:diff ...`: all repo guards and affected typechecks
    passed; assistant-engine passed 2,725 tests with 5 skipped, assistant CLI
    passed 128 tests, assistant-runtime passed 1,896 tests with 2 skipped, and
    assistantd passed 40 tests
  - an earlier assistant-runtime aggregate run had one unrelated timeout in a
    mixed system/device checkpoint test; its isolated rerun passed in 686 ms
- External local blocker:
  - the final CLI source phase timed out in eight prepared-runtime-dependent
    tests while waiting on the shared workspace artifact lock; the same
    unrelated lock contention reproduced across runs and is outside this
    engine/runtime diff
- Still required on the exact pushed candidate:
  - `pnpm verify:acceptance`
  - preliminary and final ReviewGPT gates plus PR CI
