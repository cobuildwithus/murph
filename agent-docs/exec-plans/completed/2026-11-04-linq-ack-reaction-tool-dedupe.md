# One tapback per member message: Web ack vs Murph's react_to_message

Status: completed

## Problem

Web adds an "on it" tapback (⏰ 📊 🔎 📝 👀 🎨 🎶 📅 🏆, or the native Like
for 👍) to a direct iMessage about 0.3 to 0.7 s after receipt. Separately,
Murph's own `react_to_message` tool (heart | thumbs_up | laugh) queues a
`reactionPatch` that the runtime delivers with the turn's final action. In
iMessage one sender has one tapback per message, so when both target the same
message, Murph's later reaction replaces ours (⏰ becomes ❤️) or repeats it
(👍 then 👍). Murph has no idea Web already reacted.

Today's ordering facts (read from code):

- Murph's reaction is delivered through
  `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
  (`setLinqMessageReaction` dependency): engagement route with
  `authorityCheckOnly: true`, then again with `authorityCheckOnly: false` at
  provider entry, which writes a `hosted_linq_delivery` dispatch fence.
- The Web tapback claim refuses once any `hosted_linq_delivery.attempted_at`
  is at or after the message's receipt, so if Murph's reaction is delivered
  first, Web never reacts. That direction is already safe.
- The remaining clash is Web first, Murph's reaction later on the same message.
- A reaction can be a reaction-only reply: with `answeredMailboxItemIds`, its
  delivery confirms mailbox consumption (`acceptedLinqReactionTiming`).

## Design

Tell Murph at tool time and queue nothing when the message already has our
tapback. First tapback wins; Murph learns which emoji is there.

1. **Web store** (`linq-ack-reaction-store.ts`, migration): the claim also
   records `message_lookup_key` (HMAC via `createHostedLinqMessageLookupKey`)
   and `reaction` (the emoji) on the chat's row. New
   `readHostedLinqAckReactionOnMessage({ linqChatId, messageId, prisma })`
   returns the emoji when a row under any chat key version has
   `claimed_at IS NOT NULL` and its message key is one of the message's read
   candidates; otherwise null. A released reservation (definite Linq refusal)
   reads as no tapback. An ambiguous send keeps its reservation, so it reads
   as tapped (it probably landed).
2. **Engagement route**: when `deliveryPurpose === "reaction"`, a
   `replyToMessageId` is present, and the resolved route is a direct thread,
   the response includes `ackReaction: "<emoji>"` from step 1. Read-only, in
   the existing transaction; old runners never send this purpose.
3. **Cloudflare effects port**: pass through `ackReaction` when it is a short
   non-empty string.
4. **Runtime**: a new optional hosted tool port
   `messageTapbackReader.read({ messageId, threadId })` built from the effects
   port. It calls the engagement route with `authorityCheckOnly: true`,
   `deliveryPurpose: "reaction"`, `replyToMessageId`, `target`, and
   `targetKind: "thread"`, bounded by a 1.5 s timeout. Any error or timeout
   returns null (fail open: the reaction is queued as today).
5. **Engine**: for `action: 'reaction'`, the accepted-message authorizer also
   returns the target's provider message id and thread id (already resolved
   for delivery). The `react-to-message` executor asks the reader; on an emoji
   it returns a successful tool result such as "no reaction sent: this
   message already has your ⏰ tapback from when it arrived" and no
   `reactionPatch`. Null, or no reader (local/Telegram), keeps today's path.

## Rejected alternatives

- **Skip at delivery time.** A reaction-only reply consumes mailbox items at
  delivery; skipping the provider call would need a fake provider attempt or
  new consume semantics. Riskier than not queueing the patch.
- **Put the tapback in Murph's prompt.** The tapback lands asynchronously,
  usually after the turn's context is assembled, so it would often be missing.
- **Let Murph's reaction replace ours.** The owner asked for no clash.

## Races and accepted windows

- Murph's reaction delivered before the Web claim: its fence ends the burst
  and Web does not react (existing).
- `react_to_message` called before Web's tapback is reserved (needs a model
  tool call within ~0.5 s of receipt): the reader sees nothing, Murph's
  reaction is delivered later and replaces ours. Accepted and logged.
- The chat row is overwritten by the next burst's claim: a reaction to an older
  message no longer sees its tapback. Accepted.

## Deploy and skew

- Web first (migration adds two nullable columns; the route ignores the
  purpose for old runners), then the Cloudflare runner. The switch stays off
  until both are live, then goes on.
- New runner with old Web: no `ackReaction`, so the reaction is queued as
  today. Old runner with new Web: never asks, so today's behavior.

## Regression tests

- Postgres proof: the claim stores the message key; the read returns the emoji
  for the tapped message only; null for another message, after release, and
  for a chat with no row; previous chat key version still visible.
- Engagement route: `ackReaction` only for `deliveryPurpose: "reaction"` on a
  direct thread; no dispatch fence on the authority-only call.
- Cloudflare decoder: string passes through; non-strings dropped.
- Runtime port: request shape (purpose, message, target, authority-only);
  emoji returned; error and timeout return null.
- Engine: tapped message gives the skip text and no `reactionPatch`; null
  reader result and absent reader queue the patch as before.
- Real Codex journey: a member message that already has a tapback, with the
  model prompted into reacting, gets the skip result, no reaction is
  delivered, and the reply does not mention it.

## Plan review (ReviewGPT, vonneumann, 2026-11-04)

Response: `audit-packages/plan-linq-ack-reaction-tool-dedupe.md`. All three
findings accepted; the design above is superseded where they differ.

1. **Reserved vs confirmed (accepted).** A reservation can still end with no
   tapback (definite refusal, expiry before send, failed release), so treating
   it as "already reacted" could leave a reaction-only reply silent. Web now
   reports `ackReaction` only when `reacted_at IS NOT NULL` for that message,
   the same evidence that suppresses progress. An in-flight reservation reads
   as no tapback, so Murph's reaction is queued; if Web's send lands first,
   Murph's later reaction replaces it. That window is the ~100 to 300 ms
   claim-to-confirm span overlapping a tool call; accepted.
2. **Skipped reaction-only completion keeps the burst open (accepted, fixed by
   a time bound).** With no outbound, a confirmed tapback on message A kept
   blocking B's tapback and suppressing B's progress. The same gap already
   existed for any finish-without-reply after a tapback. A claim now counts for
   the current burst only within 2 minutes of `claimed_at`
   (`HOSTED_LINQ_ACK_REACTION_BURST_MAX_AGE_MS`), applied in the claim's
   `taken` check and in progress coverage, using the app clock that wrote
   `claimed_at`. A later message after that gets its own tapback; a progress
   note more than 2 minutes in may go out (a useful "still on it").
3. **Keep the lookup inside the accepted-message authorizer (accepted).** One
   optional callback on the hosted execution context,
   `readLinqMessageAckReaction({ linqChatId, messageId, signal })`, is invoked in
   the authorizer's reaction branch after target validation, only for direct
   Linq targets. The authorizer returns `{ targetInputId, ackReaction? }`; the
   executor picks the skip result or the existing patch. No tool-context port,
   and no provider ids in the tool-facing result. Lookup errors and the 1.5 s
   timeout fail open; authorization failures still reject.

Other review notes adopted: the provider ids are `event.replyTarget.threadId`
(Linq chat) and `event.replyTarget.messageId`; regression tests rotate both the
chat-key and message-key families; legacy rows are not backfilled. The early
race is best-effort, not code-bounded (the classifier may take up to 3 s).
The switch is off, so no old Web claim writer is running when this deploys.
The skip result never sets a final action, so a reaction-only reply still ends
through `finish_without_reply` and its existing terminal evidence.

## Built (2026-11-05)

- Web: migration `20261105060000_hosted_linq_ack_reaction_message` (two
  nullable columns); the claim writes the message key and emoji;
  `readHostedLinqAckReactionOnMessage` (confirmed only, both key families);
  `HOSTED_LINQ_ACK_REACTION_BURST_MAX_AGE_MS = 120_000` in the claim's `taken`
  check and in progress coverage; the engagement route returns `ackReaction`
  for `deliveryPurpose: "reaction"` on a direct thread, read-only.
- Cloudflare effects port: passes a trimmed `ackReaction` of at most 16 chars.
- Runtime: `readHostedAssistantLinqMessageAckReaction` (authority-only,
  fail-open) behind the hosted execution context's
  `readLinqMessageAckReaction({ signal, targetInputId })`, which reads the
  accepted input event for the real Linq chat and message ids.
- Engine: the accepted-message authorizer's reaction branch asks only for Linq
  targets after authorization, bounded at 1.5 s; the `react_to_message`
  executor returns the skip text with no `reactionPatch`.

Verification: Postgres proof 11/11 (4 new: exact-message read, refusal
release, both key families rotated, burst max age for tapback and progress);
engagement route and ack unit suites 195/195; Cloudflare runner platform
338/338; runtime callbacks 326/326; engine steering, native-reply-prefix,
runtime-tools, generate-image, dynamic-tool-runtime and target-selection
pass. Two scripted-runtime list-limit tests need a built `@murphai/murph` CLI
locally and are left to CI. Real Codex journey ("perfect, thank you so much!!
you are the best 🙏" on a tapped message) passed 3 of 3: one
`react_to_message`, skipped, `finish_without_reply`, no reaction queued, no
text.
Updated: 2026-11-05
Completed: 2026-11-05

## Follow-up: Murph's reaction may replace the tapback (owner, 2026-11-05)

The owner prefers that Murph can react over the Web tapback, as long as Murph
knows what the original was. `react_to_message` now always queues a
different reaction and its result says "it replaces the ⏰ tapback you put on
this message when it arrived … No need to mention it." The one skip left is
the same reaction (thumbs_up over Web's native 👍 Like), which would change
nothing in iMessage. Web, the engagement route, the runtime lookup and the
2-minute burst cap are unchanged. Real Codex journey 3/3: ❤️ queued over ⏰,
`finish_without_reply`, no text.
