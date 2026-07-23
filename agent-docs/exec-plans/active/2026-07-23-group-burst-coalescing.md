# Group-chat burst coalescing and last-wins steered replies

## Problem

In group chats, a burst of N inbound messages produces N serial Murph replies:

1. No pre-turn coalescing exists anywhere. Every webhook append fires an
   immediate wake, so the turn for message 1 starts instantly and the
   auto-reply scanner's adjacent-message batching (`collectAssistantAutoReplyGroup`)
   almost always sees a batch of one.
2. When a later message does arrive mid-turn, steering appends instead of
   revising: completed-but-undelivered finals are delivered as their own
   messages ahead of the final reply (`deliverAssistantPrecedingReplies`,
   the PR #140 behavior). Correct for DMs; in groups it defeats coalescing.
3. The model essentially never uses `murph.select_reply_target`, so replies to
   no-longer-latest messages land unanchored and read as misplaced.

## Change (three levers, all group-scope only; DM behavior unchanged)

### A. Pre-turn burst hold (5s, extending to a 15s cap)

Before opening an auto-reply turn whose pending batch is group-thread inbound
conversation messages (conversation directness = not direct), hold until the
newest pending message is >= 5s old OR the oldest pending message is >= 15s
old, whichever comes first. New arrivals during the hold join the batch and
reset the 5s clock. The hold is an in-process bounded wait at the automation
scan seam in `packages/assistant-engine` (engine-owned pure hold decision +
two-phase channel parking: ready channels proceed first, then held channels
resume after the earliest residual wait and re-list so late arrivals join).
Parking the whole channel preserves its cursor ordering while unrelated
channels proceed. No persisted state, new wake scheduling, or cross-package
contract changes; if the process dies mid-hold the existing wake backstops
re-deliver. System/automation mailbox items and direct conversations are never
held.

### B. Last-wins steered finals in groups

When `resolveAssistantConversationScope(...) === 'group'`, superseded steered
finals (`precedingResponseSegments` in
`packages/assistant-engine/src/assistant/local-service.ts`) are dropped:
not delivered and not persisted as assistant transcript entries. The provider
thread naturally retains them as working context. A short static line in the
group-scope system prompt section tells the model that an answer finished
before a steered group message arrives is replaced only by a later completed
answer, and that replacement must stand alone. If the model instead chooses
`finish_without_reply`, the last completed answer is promoted through the
normal final-reply delivery and transcript path so silence cannot discard an
owed answer.

### C. Thread-when-stale reply-target guidance

Adjust the group-chat skill "Message shape" guidance
(`packages/assistant-engine/skills/group-chat/SKILL.md`): keep merged
burst-covering replies flat, but select the reply target via
`murph.select_reply_target` when the response addresses a message that is no
longer the latest inbound or when multiple conversations interleave.

## Invariants

- DM (direct-scope) turn timing, steering, per-segment delivery, and
  transcript persistence are byte-for-byte unchanged.
- Product-critical flow preservation: current-inbound replies must still be
  answered; the hold only delays, never drops, and is hard-capped at 15s.
- A held channel's cursor never advances past the held group; candidates on
  other channels can still proceed during the first scan phase.
- No new persisted state (placement gate: nothing to place).
- Group-scope prompt additions are thread-stable static text (scope is stable
  per group thread); no per-turn fingerprint churn.
- Mailbox bookkeeping (answered item sets, consumed marks, dedupe
  fingerprints) unchanged; lever B only gates delivery/transcript of
  superseded segments.

## Files (expected)

- `packages/assistant-engine/src/assistant/automation/` — hold decision +
  scan-seam wait (new small module or `grouping.ts`), scanner integration.
- `packages/assistant-engine/src/assistant/local-service.ts` — group-scope
  gating of preceding-segment delivery + transcript persistence.
- `packages/assistant-engine/src/assistant/system-prompt.ts` — group-scope
  static line for last-wins steering.
- `packages/assistant-engine/skills/group-chat/SKILL.md` — reply-target
  guidance tweak.
- Matching tests under `packages/assistant-engine/test/`.

## Overlaps (non-exclusive, keep narrow)

- `automation/reply.ts` and hosted-runtime files are owned by the mailbox
  consumed-at Part 1a and PR 550 lanes; prefer scanner/local-service seams and
  avoid editing those files unless strictly required.

## Verification

- New unit tests: hold boundary conditions (fresh burst held, 5s quiet
  releases, 15s cap releases, direct scope never held, system items never
  held, late arrival extends hold and joins batch, unrelated channels proceed
  while the held channel cursor stays parked); group last-wins gating
  (superseded segments dropped in group scope, last completed answer promoted
  after no-reply, segments delivered in direct scope; transcript entries
  follow).
- `pnpm test:diff` over touched paths; assistant-engine owner suite; typecheck.
