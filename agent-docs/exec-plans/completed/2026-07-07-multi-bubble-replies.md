# Multi-Bubble Texting Replies

Status: completed
Owner: Fable (supervising), Codex c1 (implementation)
Worktree: `murph-reply-bubbles`, branch `multi-bubble-replies`

Our utmost priority is clean, simple, long term maintainable and composable architecture with minimal complexity.

## Why

Murph replies over iMessage/Telegram/WhatsApp as one long paragraph per turn. Users find these walls of text hard to parse; human texters (and competing products) send several short bubbles per turn — one idea per bubble, question last. We want Murph's final reply to arrive as up to 4 short, ordered message bubbles on texting channels, with zero behavior change on email, local chat, and every non-reply delivery path.

The message-structure rules below are grounded in a research pass (CMC corpora, mobile readability, health-texting RCTs, conversation-design guidance): human same-speaker IM turns average ~1.7 messages, chunk at clause/sentence boundaries, and hand off the turn with a single question; message volume correlates with opt-outs, so bubbles must never become padding.

## Design

One new concept: a **reply bubble delimiter** the model writes inside its final reply, and one small pure module that owns it. Delivery splits on it for bubble-capable channels; every other surface strips it. No new state, no new tools, no scheduler/queue machinery.

### 1. New module `packages/assistant-engine/src/assistant/reply-bubbles.ts`

Pure functions, no I/O:

- `ASSISTANT_REPLY_BUBBLE_DELIMITER` — a line consisting solely of `---`.
- `MAX_ASSISTANT_REPLY_BUBBLES = 4`.
- `assistantChannelSupportsReplyBubbles(channel: string | null): boolean` — true for `linq`, `telegram`, `whatsapp` (normalized lowercase). Email, local, null: false.
- `splitAssistantReplyBubbles(text: string): string[]` — split on delimiter lines, trim each bubble, drop empties; if more than 4 bubbles, fold the overflow into the 4th joined with blank lines; a text with no delimiter returns `[text]`.
- `stripAssistantReplyBubbleDelimiters(text: string): string` — replace delimiter lines with a paragraph break (collapse to the same text `splitAssistantReplyBubbles` would produce, joined by `\n\n`).

Splitting must be delimiter-line based (a line that is exactly `---` after trimming), never substring-based, so `---` inside a longer line is untouched.

### 2. Delivery split in `delivery-service.ts`

Inside `deliverAssistantReply` (the seam both the final reply and steered preceding segments already flow through):

- Resolve the channel via the existing `resolveAssistantCurrentAudienceDeliveryFields`.
- If `assistantChannelSupportsReplyBubbles(channel)` is false: deliver `stripAssistantReplyBubbleDelimiters(response)` exactly as today. One message, unchanged keys/outcome.
- If true and the split yields N > 1 bubbles: deliver bubbles 0..N-2 sequentially first, each with idempotency key `` `${baseKey}:bubble:${i}` `` (fallback `` `assistant-bubble:${turnId}:${i}` `` when no base key, mirroring the existing `:segment:`/`:progress:` patterns) and **no media**; then deliver the final bubble with the original base key and the turn's media. Return the final bubble's outcome so receipts, first-contact marking, and turn finalization semantics are untouched.
- If an earlier bubble's delivery fails, stop and return that failed outcome (do not send later bubbles out of order).
- Ordering: intents drain FIFO by `createdAt` (`outbox/store.ts` sorts ascending), and bubbles are created sequentially, so queue-only hosted turns deliver in order. Failure-retry reordering risk is identical to the already-shipped preceding-segment path — acceptable, do not add ordering machinery.

Media on the last bubble only; `dropUnsupportedAssistantResponseMediaForChannel` continues to apply as today.

### 3. Persisted text is always clean

The transcript, receipts, and any other persisted/rendered copy of the reply must never contain the delimiter. In `local-service.ts` (and any sibling path that persists the final response — trace `resolveAssistantProviderFinalResponseText` / `resolveAssistantProviderTranscriptText` / `finalizeAssistantTurnFromDeliveryOutcome` consumers), apply `stripAssistantReplyBubbleDelimiters` to the text used for transcript/receipt persistence while passing the raw text to delivery. Preceding steered segments persist via `precedingAssistantTranscriptTexts` — strip those too.

Do not touch: `send_progress_update`, the notification-decision structured-output path, reactions, media handling, outbox internals, channel adapters.

### 4. Prompt guidance in `system-prompt.ts`

In `buildAssistantEvidenceAndReplyStyleText`, for channels where `assistantChannelSupportsReplyBubbles` is true (import the predicate — one shared source of truth with delivery), append a texting-rhythm section. Content requirements (wording is yours, keep it tight and in the same voice as the surrounding prompt):

- Reply like a person texting. When a reply has more than one conversational move, split it into 2–3 short bubbles — never more than 4 — by writing a line containing only `---` between bubbles. The delivery layer turns each into its own message.
- One move per bubble: acknowledge/react, answer, explain, or ask. One or two short sentences per bubble; split at sentence boundaries, never mid-thought.
- Lead with the answer or reaction. If the user needs to act or respond, ask exactly one question, make it the final bubble, and put nothing after it.
- A short reply stays one bubble. Never stretch a simple answer across bubbles or use bubbles as padding.
- Keep anything the user will save, follow, or reread — plans, lists, step-by-step instructions, logged data, schedules — intact in a single bubble, with conversational framing in bubbles around it. Never separate a safety caveat or dosage/contraindication warning from the instruction it modifies.

This section is thread-birth-stable context (it lives in the thread layer), so changing it rotates threads through the contract fingerprint — expected, fine.

Deliverability framing (see `agent-docs/operations/imessage-deliverability.md`): keep the guidance conversational-reply shaped. Bubbles only apply to replies the model is already sending in an active conversation; the cap and "never padding" rule keep outbound volume bounded. No acquisition/broadcast framing anywhere in the prompt text.

### 5. Tests

- New unit tests for `reply-bubbles.ts`: no-delimiter passthrough, basic split, trim/empty-bubble dropping, leading/trailing/consecutive delimiters, >4 fold into 4th, `---` inside a longer line untouched, strip round-trips.
- Delivery tests (extend the existing delivery-service/local-service test files): linq reply with delimiters → N ordered sends with the `:bubble:` key scheme, media only on last, base key on last; email reply with delimiters → single stripped send; early bubble failure stops the sequence; queue-only dispatch produces N ordered intents.
- Prompt tests: update/add assertions that the texting-rhythm section appears for `linq`/`telegram`/`whatsapp` and not for `email`/local. Follow the existing verbatim-string assertion style.
- Transcript/receipt tests: persisted response text is delimiter-free when the model emitted delimiters.

Run `pnpm test:diff` over the touched paths, plus the assistant-engine owner coverage command if `test:diff` does not truthfully cover it, plus `pnpm typecheck`.

## Edge cases to cover

- Reply that is only delimiters/whitespace → deliver nothing extra; treat as today's empty-reply handling (trace what happens now and preserve it).
- Delimiter emitted on a non-bubble channel (model confusion) → user never sees `---` (strip path).
- Steered turn whose preceding segment itself contains delimiters → segment bubbles compose with `:segment:{ordinal}:bubble:{i}` keys via the same seam (verify key uniqueness).
- Group chats use the same channels — same behavior, no special casing.
- Hosted linq requires an idempotency key (`hostedDeliveryChannelRequiresIdempotencyKey`) — bubble keys derive from the base key so this invariant holds; the no-base-key fallback only occurs on paths where the base send would also have no key.

## Non-goals

- No tone change (deferred; future user-selectable tone).
- No typing-indicator/pacing delays between bubbles (research says they backfire for experienced users; also complexity).
- No changes to progress updates, notification decisions, email, or web chat rendering.
- No new persisted state anywhere.

## Verification

1. Unit + delivery + prompt tests above, green.
2. `pnpm typecheck`.
3. Static walk of the delivery path proving: non-bubble channels and delimiter-free replies take byte-identical code paths to today wherever practical, and the receipt/first-contact/finalization semantics are keyed off the final bubble's outcome.
Updated: 2026-07-07
Completed: 2026-07-07
