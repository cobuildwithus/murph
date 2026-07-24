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

### A. Model-discretion waiting inside a live turn

The pre-turn hold was replaced by model-discretion waiting through
`murph.wait_for_replies`, available only in group scope with a 3-10 second
clamp and a two-call, 15-second cumulative turn budget. Because the turn is
already live, messages arriving during the wait enter it through the existing
active-turn steering path, so Murph can answer the whole burst once or reply
immediately when the moment calls for it.

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
- Waiting is optional model behavior inside an already-open group turn; it
  never schedules a later message or delays an answer someone needs now.
- Mid-wait arrivals use the existing active-turn steering path and therefore
  remain visible before the model commits its final answer.
- No new persisted state (placement gate: nothing to place).
- Group-scope prompt additions are thread-stable static text (scope is stable
  per group thread); no per-turn fingerprint churn.
- Mailbox bookkeeping (answered item sets, consumed marks, dedupe
  fingerprints) unchanged; lever B only gates delivery/transcript of
  superseded segments.

## Files (expected)

- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts` and
  `packages/assistant-engine/src/assistant-codex.ts` — group-only wait tool and
  turn-local call/time budget.
- `packages/assistant-engine/src/assistant/automation/` — remove the scanner
  hold and restore immediate pre-turn selection.
- `packages/assistant-engine/src/assistant/local-service.ts` — group-scope
  gating of preceding-segment delivery + transcript persistence.
- `packages/assistant-engine/src/assistant/system-prompt.ts` — group-scope
  static lines for waiting and last-wins steering.
- `packages/assistant-engine/skills/group-chat/SKILL.md` — wait discretion and
  reply-target guidance.
- Matching tests under `packages/assistant-engine/test/`.

## Overlaps (non-exclusive, keep narrow)

- `automation/reply.ts` and hosted-runtime files are owned by the mailbox
  consumed-at Part 1a and PR 550 lanes; prefer scanner/local-service seams and
  avoid editing those files unless strictly required.

## Verification

- Dynamic-tool tests: group-only availability and execution authority, strict
  arguments, 3-10 second clamping, two-call/15-second turn budget, and
  abort-aware early completion; prompt and skill assertions for discretionary
  waiting; group last-wins gating (superseded segments dropped in group scope,
  last completed answer promoted after no-reply, segments delivered in direct
  scope; transcript entries follow).
- `pnpm test:diff` over touched paths; assistant-engine owner suite; typecheck.
Status: completed
Updated: 2026-07-23
Completed: 2026-07-23
