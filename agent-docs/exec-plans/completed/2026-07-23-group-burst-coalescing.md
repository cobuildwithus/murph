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
old, whichever comes first. A held group defers to the existing runtime wake
owner: the scanner skips it without advancing its source cursor and merges the
hold's resume time into the scan result's reply wake (`replies.nextWakeAt`),
which the run loop and hosted maintenance already project into the runtime's
next wake. Selection is frozen per pass, so a mid-hold arrival lands in a later
pass, re-lists old plus new messages, and recomputes the hold (extension). The
hold fails open when a later same-source candidate is already visible, and a
held-only pass no longer defers due cron work. No in-process sleeping, no
persisted state, no new wake owner. System/automation mailbox items and direct
conversations are never held.

### B. Last-wins steered finals in groups

The Codex adapter already owns final-answer selection: `canApplyNoReplyPatch`
refuses `finish_without_reply` while a completed answer is still owed, and a
trailing completed answer stays the final response unless a newer completed
answer supersedes it. The delivery layer adds only the group-scope policy:
when `resolveAssistantConversationScope(...) === 'group'`, superseded steered
finals (`precedingResponseSegments`) are suppressed from delivery and vault
transcript persistence; direct scope keeps per-segment delivery unchanged. The
group system prompt states these semantics in static thread-stable text.

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
Status: completed
Updated: 2026-07-23
Completed: 2026-07-23
