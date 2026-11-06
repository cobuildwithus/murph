# Sleep card plus a short note, ordinary and scheduled

Status: completed
Created: 2026-11-04
Source baseline: `f77dc68436`

## Outcome

The founder asked Murph to send the sleep card each morning with "a short note about how I'm trending and anything else interesting", in place of the current morning message. Murph answered that it "can't combine both in the same update yet".

After this change, a sleep card reply can carry one short note:
- **Ordinary turns:** when the member asks for a note.
- **Scheduled turns:** when the saved instructions of that exact occurrence ask for one.

The card is delivered first and the note as a second iMessage right after it. "How did I sleep" with no note request stays card-only. Murph can then switch the existing morning automation itself by patching its instructions; no authoring change is needed.

## Why it fails today (file:line, origin/main `f77dc68436`)

Paths: `E=packages/assistant-engine`, `O=packages/operator-config`, `R=packages/assistant-runtime`, `W=apps/web`.

- **Policy forbids it.** The sleep tool description (`E/src/assistant-codex/dynamic-tool-catalog.ts:312`), the system prompt (`E/src/assistant/system-prompt.ts:1528`), `E/skills/sleep-improvement/SKILL.md:31,33` and `E/src/assistant/model-behavior.ts:83` all say the card is the whole reply.
- **Code discards a note.**
  - Ordinary turns: `buildCodexFinalResponsePresentation` replaces model text with the rendered card text (`E/src/assistant-codex.ts:892,928`).
  - Scheduled turns: notification presentation prefers the rendered card over the parsed `send_message.text` (`E/src/assistant/notification-turn.ts:661,1099`).
  - The sleep renderers ignore `companionMessage` (`O/src/assistant-response-cards.ts:251,297,405`).
  - The native branch sends the card, then returns (`E/src/assistant/channels/runtime.ts:823`).
- **Transport.** A Linq `imessage_app` part must be the only part of a message, so the note needs a second send ([Linq iMessage apps constraints](https://docs.linqapp.com/channel/imessage/guides/messaging/imessage-apps/#constraints)).
- **Already works.** Scheduled private turns already expose the tool (`E/src/assistant/codex-turn/planning.ts:766`; `dynamic-tool-catalog.ts:1928`). The static image card is the same `imessage_app` send with `interactive:false` (`O/src/linq-runtime.ts:733`).

## Design

1. **The note is ordinary text; there is no new field.**
   - **Where it comes from:** the model's final text after a successful sleep card in an ordinary turn, or `send_message.text` in a scheduled turn.
   - **How it travels:** it rides the existing `companionMessage` and `message` plumbing.
   - **One shared reader** in `O/src/assistant-response-cards.ts` makes rendering idempotent and keeps old card-only rows card-only:
     - trim the input;
     - an exact bare summary means no note;
     - strip one exact `summary + "\n\n"` prefix;
     - anything else is the raw note.
2. **Rendering (O).** For `sleep_summary`:
   - `renderAssistantResponseCardText` and `renderAssistantResponseCardTranscriptText` return the summary, a blank line, then the note, so text fallback and history carry it.
   - Telegram appends the escaped note after the card content.
   - The native layout is unchanged.
3. **Presentation (E).**
   - **Ordinary turns:** `assistant-codex.ts:892/928` passes a sleep companion from `modelMessage` into both card renderers and keeps the composed presentation. `local-service.ts:3141` already passes `providerResult.response` as the companion.
   - **Scheduled turns:** for a sleep card, `notification-turn.ts` passes the bare summary as `runtimeResponse` into `resolveAssistantNotificationDecision`, so a valid `send_message.text` survives (`:2218` is unchanged). It then renders response and transcript with `decision.text` as the companion, before the generic replacement at `:1099`. Blank, malformed or skip decisions still recover card-only, and the raw JSON never becomes visible text.
   - **Unchanged:** nutrition's fixed introduction and every other card.
4. **Delivery (E `channels/runtime.ts`, O `linq-runtime.ts`), reusing the rich-link two-send contract unchanged.**
   - **Order:** send the card under key K. Then, for a non-empty sleep note, send it with the existing plain-message primitive (no trailing-link split) under `${K}:note`, derived before `buildLinqProviderIdempotencyKey` hashing.
   - **Sizes:** run the existing Linq size assertion on the note before the card send.
   - **Success:** require two distinct ids; return ordered ids and effects (card `{message:null}`, then the note's effect), with the note id as the final provider id.
   - **Note failure:** throw the existing `createLinqRichLinkPartialDeliveryFailure`, which has code `ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY`, aggregate K, and the card id and effect.
   - **Who already handles that failure:**
     - the runner outbox persists the partial (`E/src/assistant/outbox/dispatch-state.ts:477,541,618`) and replays the whole delivery with the same keys (`outbox.ts:1260,2063`);
     - hosted callbacks record the partial without consuming mailbox items (`R/src/hosted-runtime/callbacks.ts:5182,6135`);
     - the Web receipt store keeps a one-id partial incomplete and completes it on two ordered ids (`W/src/lib/hosted-onboarding/linq-delivery-store.ts:1380,1647,2740`).
     - None of these readers needs the message to be a link. Linq returns the original response for a repeated key, so replay dedupes the card and sends or dedupes the note.
   - **Reply context:** keyed by the replied-to id (`E/src/assistant/automation/reply.ts:5287`). A reply to the note resolves to the note's text; a reply to the card behaves as today.
   - **Fallback:** keep the note send outside the native-card rejection catch. Capability and definitive-rejection fallbacks send the composed summary plus note as one text, as today.
5. **Replay guard, local to the native branch.** Native selection isn't frozen.
   - **The risk:** a retry after an accepted card whose capability check *errors* would fall back to text under K. Linq dedupes K and returns the card, so the outbox completes without the note.
   - **The rule:** for a `sleep_summary` card with a non-empty note, a capability-check error (`runtime.ts:808–818`) is rethrown as a retryable pre-send failure instead of falling back to text.
   - **Effect:** a first attempt is delayed, never degraded. A replay keeps retrying until the check succeeds, then dedupes the card and sends the note.
   - **Card-only replies keep today's fallback.**
   - **Residual, accepted:** a *definitive* "not iMessage capable" answer between attempts after an accepted card would lose the note. That needs the recipient to leave iMessage within the retry window.
   - **Rejected alternative:** threading a replay hint from persisted partial evidence through the outbox, descriptors, `R/platform.ts`, `callbacks.ts` and `hosted-provider-effects.ts` closes that residual case, but it adds plumbing across five files.
6. **Policy text (no em dashes).** Replace the sleep tool description, the system-prompt line and the skill line with the card-alone default plus the exception: "if the member's request or the saved instructions for that exact scheduled occurrence also ask for a short note, add one or two evidence-based sentences after successful attachment; ordinary final text in attended turns, `send_message.text` in scheduled turns; attach no media". Qualify the skill's compound-question line and the `model-behavior.ts:83` card rule.

## Not doing

- No note tool argument, persisted note field, checkpoint, failure code, Web production change, iOS or envelope change.
- No character cap or truncation. The policy asks for one or two sentences; transport limits stay as they are.
- No automation-authoring change. `murph.automation` inspect and patch already exist (`E/src/assistant-codex/dynamic-tools/automation.ts:308,328`).

## Tests

- **O:** renderer idempotence (raw note, composed, empty, legacy summary); transcript equality; escaped Telegram note; a note ending in a URL stays one send; derived key hashing for long K.
- **E:**
  - an ordinary note goes through presentation, outbox and history;
  - a scheduled parsed note survives, and blank, malformed or skip decisions still recover card-only;
  - native and static ordering;
  - capability and definitive-rejection fallback;
  - note failure gives a partial with the card id, then replay dedupes the card and sends the note once;
  - a capability-check error with a note rethrows, and without a note falls back as today;
  - reply-to-card versus reply-to-note context;
  - updated digests (`test/assistant-codex-turn-planning.test.ts`, `test/model-behavior.test.ts`) and sleep-card policy assertions.
- **R:** a hosted partial outcome carries the card id and consumes no mailbox inputs; completion carries both ordered ids.
- **W (test only):** extend `test/hosted-linq-rich-link-partial-postgres.test.ts` with card and note identities. The first receipt can't complete the partial, and two ids complete it.
- **Live journeys** (`pnpm test:assistant:live`, synthetic): default card-only, requested note, scheduled note, and editing an existing automation's instructions.

## Deploy and skew

- **Runner only.** Web readers already accept this contract.
- **Old rows:** old card-only outbox rows render as card-only.
- **Rollback hazard:** an old runner replaying a new card-plus-note partial would complete without the note. On rollback, accept that rare loss or let pending partials drain first.
- **Ordering:** the policy text ships in the same runner bundle as the delivery code, so no runner can tell the model to write a note it would drop.

## Review outcome

ReviewGPT architecture review, 2026-11-04: four P2 findings. I spot-checked each in source and accepted all four. They amend the design above and win where they differ.

1. **Accepted: capability classification.**
   - **Evidence:** `checkLinqIMessageCapability` returns `response?.available === true` (`O/src/linq-runtime.ts:712`), so a malformed successful body reads as "not capable" and bypasses the local guard. Replay would then fall back to text under K and lose the note.
   - **Change:** accept only literal boolean `available`. Anything else throws through the existing retryable provider-error path. Card-only replies still fall back on any capability error, as today. Update the malformed-shape test expectations (`http-linq-device-runtime.test.ts` around 556).
2. **Accepted: the provider owns the pair.**
   - **Change:** extend `sendLinqIMessageAppCard` (`O/src/linq-runtime.ts:715`) to:
     - read the note with the shared reader and check its size;
     - send the card under K, then the note under the unhashed `${K}:note` through the private `sendLinqChatMessageParts`;
     - return the ordered ids and effects (note id last);
     - wrap failures after card acceptance in `createLinqRichLinkPartialDeliveryFailure`.
   - **Engine side:** forward the provider's ids and effects and delete its manual card-effect construction (`E/src/assistant/channels/runtime.ts:836`).
   - **Card rejections:** only failures before acceptance reach the native-card rejection fallback. The wrapped code can't match `isDefinitiveLinqIMessageAppCardRejection`.
3. **Accepted: link-delay notice.**
   - **Evidence:** `maybeSendHostedLinqLinkDelayNotice` (`R/src/hosted-runtime/callbacks.ts:3344`, invoked at `:4222`) fires on any foreground one-id partial with no card check. It would send "The link is taking longer to send" for a pending sleep note.
   - **Change:** require `intent.card === null`. This is a small assistant-runtime production change, still runner-only.
   - **Tests:** a sleep-note partial sends no notice, and a text/link partial still sends it once.
4. **Accepted: live-steer promotion.**
   - **Evidence:** `promoteTrailingSteerCandidate` (`E/src/assistant-codex.ts:3939`) renders the earlier card with no companion and prefers that text, so a note would disappear during live steering.
   - **Change:** `renderCodexResponseCardPresentation` takes the sleep companion, from `modelMessage` for final presentation and from `trailingSteerCandidate.response` for promotion.
   - **Test:** a sleep card plus note, then a newer member message; the earlier segment keeps the summary and note exactly once.

Wording corrections, accepted:
- **Fallback** is ordinary text delivery. A composed summary plus note ending in an HTTPS URL keeps today's rich-link split; test it.
- **Capability-error retries** stay within the existing outbox retry budget (`retry-policy.ts`, `dispatch-state.ts:494`). Test the terminal disposition; no new retry loop.
- **Rollback:** an older runner loses the note on *any* undelivered card-plus-note intent, not only partials. The no-loss rollback drains that whole pending set.
- **Scheduled test:** add a provider result whose card renderer already composed the summary with the raw decision JSON. Delivery and transcript must carry only the parsed note, with no JSON or `privateSummary`.

Not adopted:
- A durable guard in `persistAssistantOutboxIntentLinqAppCardTextFallback`. The reviewer offered it as optional stronger protection, and it doesn't close the unrecorded-acceptance crash window. The accepted residual (a definitive "not capable" between attempts) stays documented.

## Verification outcome

Live journeys ran on real Codex `gpt-6.1-sol` against synthetic vaults. Reading the replies led to two changes after the build:
- **Note quality:** the first passing note restated the card's own numbers. The fixture had one night, so there was no trend to report.
  - The note and scheduled journeys now seed two earlier synthetic nights.
  - The policy asks for what the card does not show, such as a comparison with recent nights, without restating its numbers.
  - The note journey asserts a comparison word.
- **Prompt size:** the full note rule had been copied into two always-loaded lines (+186 tokens).
  - Those lines now name the exception and point to the deferred `murph.attach_sleep_card` description, which carries the rule once, alongside the sleep skill.
  - That cuts always-loaded growth to about +49 tokens, and the stable route prompt stays inside its existing bound.
Updated: 2026-11-04
Completed: 2026-11-04
