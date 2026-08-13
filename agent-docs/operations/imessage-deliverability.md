# iMessage Deliverability and Reply Safety

Last verified: 2026-08-09

## Purpose

This is required reading for any Murph change that can affect text-message or iMessage behavior. Read it before editing assistant/provider prompts, reply generation, outbound copy, reminder behavior, notification behavior, message scheduling, line selection, delivery monitoring, onboarding copy, or any runtime path that can cause Murph to send a message through a phone-number based channel.

The core rule is simple: design Murph messaging like a real reciprocal conversation, not a broadcast system. The highest-risk pattern is many outbound messages from one line with little or no recipient response.

## When this applies

Read and apply this guide when touching any of these surfaces:

- prompts that influence what Murph says to a user over SMS/iMessage
- code that decides when Murph sends, retries, schedules, batches, or suppresses a message
- onboarding, confirmation, reminder, alert, follow-up, or re-engagement flows
- phone-line provisioning, contact-card setup, line rotation, warmup, or health checks
- delivery receipt ingestion, failure handling, line status, or support/debug tooling
- product copy that will be sent through a phone-number based channel, even if generated indirectly by the assistant

## Non-negotiable product requirements

1. Optimize for recipient replies early.
   - Design each new conversation to earn a real recipient reply within the first three outbound messages.
   - Prefer genuine questions over one-way statements.
   - For one-way use cases like reminders or alerts, establish the thread with an explicit natural confirmation before sending repeated notifications. Ask a real question about the proposed cadence or purpose; never force a keyword or turn the conversation into a status interface.

2. Avoid broadcast-shaped behavior.
   - Do not send many new conversations from one line without replies.
   - Do not bulk re-engage cold contacts who have not replied in 30+ days.
   - Do not reuse one line for manual and automated messaging unless the automated sender is rate-aware and shares line-health state.

3. Keep content human and specific.
   - Vary messages through real context: name, current task, recent user intent, or the user's actual protocol/reminder state.
   - Do not fake variation with random padding, filler, invisible characters, or arbitrary synonym churn.
   - Avoid acquisition, signup, notification, marketing-blast, or imperative exact-send framing in prompts and templates.

4. Treat links as high risk.
   - Never use shortened URLs such as bit.ly or tinyurl in iMessage/SMS copy.
   - Prefer full first-party URLs on a domain the recipient can recognize.
   - Avoid making the first exchange primarily a link drop. Ask a reply-oriented question first when possible.

5. Pace sends conservatively.
   - Keep net-new conversations below 50 per day per line unless there is an explicit line-distribution plan and line-health monitoring.
   - Spread sends across time instead of bursting many messages in a short window.
   - Warm up new lines gradually, starting around 10-20 outbound conversations per day for the first week before increasing.

6. Make new lines earn trust before scaling.
   - Treat the first two weeks of any new line as a warmup period.
   - Prefer real inbound conversations early.
   - Set up the provider contact card for every line and route onboarding so users can save the contact.
   - Avoid the pattern of a new line sending a burst and then going silent.

7. Monitor and fail closed on line health.
   - Watch delivery receipts. "Sent" without "delivered" can indicate silent dropping.
   - Persist and correlate `message.sent` as provider-sent evidence, never as handset delivery. SMS/MMS normally emit `message.sent` or `message.failed` but no delivered/read receipt, so the absence of `message.delivered` is expected on those protocols.
   - If delivery failures spike on a line, immediately reduce or stop automated volume on that line.
   - If a line is suspected or known flagged, stop all automated sending from it until line health is investigated.
   - Do not retry through a flagged line in a way that increases volume or repeats the same content.

8. Never message low-trust sources.
   - Do not send to purchased, scraped, or otherwise untrusted contact lists.
   - Only message people with a clear user/product relationship and an expected reason to hear from Murph.

## Assistant response media

Linq's messaging contract allows up to 100 total parts and up to 40 public-URL
media parts in one message, but Murph does not treat that provider ceiling as a
normal authoring budget. A newly authored assistant response may attach at most
eight images. Exercise walkthroughs preserve complete start, transition, and
end sequences for the most useful movements within that budget; Murph teaches
fewer movements instead of sending an unsolicited sequence of image messages.
The broader 40-item persisted-media contract remains readable for rollout and
replay compatibility. See Linq's
[sending-message](https://docs.linqapp.com/guides/messaging/sending-messages/)
and [attachment](https://docs.linqapp.com/guides/messaging/attachments/)
limits.

The Linq adapter includes distinct image alternative text in the provider text
part for accessibility. It must reject a rendered text part over Linq's 10,000
character limit before private vault bytes are loaded or uploaded and before
message-provider entry, with `deliveryMayHaveSucceeded: false`.
An ordinary failed direct-chat image response remains outstanding image work:
its terminal failure input must not offer or send a text-only substitute. This
rule does not change the separately persisted, deterministic text recovery
owned by an iMessage app card.

Every hosted outbox drain records only bounded payload aggregates: base message
lengths, media counts and kinds, image-alt length, and public/private image
counts. A Linq rejection additionally retains the request part counts and body
shape, safe provider code and request id tokens, and the response body's kind,
field-name summary, length, and SHA-256 signature. Never retain the message,
alternative text, media URL, recipient, route, provider prose, or raw response
body in these diagnostics.

## Assistant response cards

Response cards are optional outbox-owned presentation siblings of response media, not a direct-send surface or a separate delivery owner. The general attachment tool serves explicit current private-direct requests, exact private-direct scheduled turns whose saved instructions explicitly request a card, and the managed meal closeout; it remains unavailable in groups. Occurrence authority alone is not card intent. A card replaces the whole final response, so it is eligible only when that card alone completely satisfies the current request. The outbox continues to own the semantic message, target, status, receipt, retry, and idempotency lifecycle, and a card cannot coexist with media.

Exercise routines use a dedicated attachment tool only to keep both Codex tool
schemas below the provider compaction limit. It creates the same outbox card
effect. Linq does not attempt a Messages-extension balloon for this card kind;
it freezes and sends the deterministic routine text through the existing
fallback identity before provider entry.

Card values are immutable message content owned by the existing outbox effect. V1 remains a supported calorie/protein/carbs/fat compatibility input. V2 adds the exact canonical fiber total and nullable per-metric goal snapshots. Each non-null goal snapshot carries only an exact target copied after a complete bounded active-goal read proves exactly one qualifying record for that daily metric and unit, plus Murph's frozen semantic assessment. A saturated result or ambiguous match leaves the target null. Missing or partial totals can carry only an `unavailable` status, and an assessed status must not point opposite the frozen total and target. The snapshot is presentation for that message, not persisted goal progress or a new source of truth. A missing or untrusted target stays null and neutral. There is no persisted remote card state, authenticated fetch API, cleanup lifecycle, or card-specific queue. Linq explicitly enables interactive presentation so recipients with the shipping Messages extension see its SwiftUI balloon; recipients without it, including Messages on macOS, retain a provider static layout. A generated image mirrors the shipping SwiftUI balloon's compact default calorie-ring and one-row nutrient composition. The bitmap is rectangular so Linq and Messages own the outer card mask. The installed extension retains its native icon and interactive identity, while the Linq request omits the optional App Store id; app-absent static cards therefore receive no provider app art, and the bitmap embeds the checked-in canonical Murph mark in the native 36×27pt upper-left badge footprint. The static image intentionally omits the native tap-to-reveal target amounts and repeated direction labels; its visible native caption preserves only the date and meal count instead of repeating totals or targets, while the safe text recovery retains the complete status meaning outside the bitmap. Null and unavailable goals stay neutral. Null, incomplete, and unavailable calorie-goal states retain a neutral ring. A short subcaption appears only when some totals are partial. The value-free `fallback_text` derives only from the validated card kind: daily nutrition, tracked workouts, generic Murph summaries, and challenge standings each receive a stable descriptive preview followed by the member-directed request for the complete semantic text. Those labels keep card values out of conversation-list, lock-screen, and notification text and avoid Apple data detectors that can downgrade the card. New V1, V2, V3, V4, and V5 cards use the same bounded HTTPS Base64URL fragment family for immutable presentation values allowed by their versioned delivery contracts; the extension also retains legacy data-URL reads for already-sent nutrition cards. Nutrition cards additionally reuse their V1 or V2 presentation envelope in a queryless image path that Vercel renders and Linq rehosts. Encoding is not encryption. Every envelope must omit member identity, canonical record references, credentials, and other authority; V3 additionally strips its tracking reference before fragment encoding, and V5's public image envelope is identity-free. The offline Messages extension decodes the fragment locally. Only the static response-card image path reaches Web, where it is rejected before render-asset reads unless it is exact and bounded; it triggers no database or remote read, application log, analytics event, persistent cache, or indexing. Hosted inbound routing keeps the opaque conversation locator used for continuity separate from the trusted provider reply thread. An ordinary auto-reply sends through that thread binding and does not duplicate it as an explicit target, so Linq appends the card to the existing direct chat. The optional capability read gets one complete 2.5-second attempt, including successful or error response-body consumption, with no transport, server, or rate-limit retry; timeout, any other capability failure, or an ineligible route immediately falls back to the same deterministic ordinary text through the existing channel delivery path. Before that text enters Linq, the current outbox intent is atomically frozen as text-only under its existing delivery key. A caught capability-check failure writes one bounded warn entry to the durable hosted runtime log before that same fallback; a successful `available: false` result remains expected and silent. After capability succeeds, only a definitive pre-acceptance app-card rejection (HTTP 400, 415, or 422) may use that text fallback; the outbox writes the same bounded entry with the rejection class, then replaces the card and promotes its durable delivery key to the distinct stable fallback key. These entries are fire-and-forget and allowlist-projected: they carry only the fallback reason and safe error classification—never error messages, card values, request or response bodies, recipient or thread values, delivery keys, credentials, or provider prose—and a failed or stalled log write does not alter control flow. That committed text identity also replaces the in-flight card authority for provider entry, receipts, failure handling, and authorized stale-direct-thread materialization, so the original card request cannot veto recovery. A process interrupted after provider acceptance therefore replays only the frozen text and same key. A timeout, transport error, rate limit, or server failure from the message mutation remains ambiguous and cannot trigger a second send. Production-device proof of visible nutrition, compact-table, and challenge-standings balloons is required before interactive rollout because provider acceptance and delivery receipts do not prove extension rendering, the provider-owned static composition, image-failure recovery, or VoiceOver output.

For the managed goal-aware daily-nutrition workflow, nullable goal snapshots remain replay/rendering compatibility only. New cards require the complete five-metric active bundle after the full current-context safety gate, including canonical memory, active-condition and active-regimen discovery, bounded lifetime procedure-event and encounter-diagnosis discovery, the bounded body-measurement read, and both bounded canonical pregnancy-evidence reads: `pregnancy-test` measurements and detailed canonical test events. A failed, saturated, unsafe, ambiguous, unit-incompatible, comparator-incompatible, or incomplete result suppresses the card with no Goal or measurement mutation. An explicit completed bariatric procedure, relevant active documented/suspected encounter diagnosis, or explicit positive pregnancy result from either canonical owner uses that same non-numeric path; a canonical test's `unknown` result classification may qualify only with strict pregnancy/hCG identity and explicit positive text. Planned, ordered, cancelled, inactive, resolved, historical, rule-out, ruled-out, pending, unknown status alone, numeric-only, ambiguous, or unrelated evidence does not prove a current exclusion. After explicit interactive card or target-setting intent, a genuinely missing bundle creates or updates one paused canonical proposal and explains its five provisional values in ordinary text; only a later unambiguous acceptance may recheck safety, activate and read back the proposal, re-read same-date totals, and attach the pending card. Scheduled closeout authority never permits safety questions, target setup, or proposal mutation.

Generic compact tables use V3. Workout static images use the compact V4 tuple
wire, while an editable native workout uses V6 with its opaque action binding.
V3 and V4 reuse their authority-free presentation envelope in the same bounded
queryless image path. The static renderer mirrors the native table or
workout summary. Generic Linq provider chrome retains its title, optional
subtitle, rows, and footer. Structured-workout provider chrome stays bounded to
the title plus derived progress instead of repeating every rendered set.
Generic static tables keep one shared header whenever exact intrinsic header and
cell tracks plus gutters fit the raster, regardless of column count; only
genuinely overwide content uses repeated full-width field labels.
Complete workout semantics remain available through the deterministic text
renderer and value-free text-recovery fallback. V3 tracking stays only in
the semantic transcript and is stripped before both encodings; V4 contains no
tracking or canonical event reference. Challenge standings use the authority-free
V5 envelope in authenticated Linq groups. Their native fragment and complete
semantic captions preserve the room-authorized title and labels. The generated
image instead uses a fixed title, no subtitle or footer, and ordinal participant
or team labels so the public path carries no challenge or member identity; it
still preserves scorer-owned order, values, target, coverage, and the native
ranked or collective hierarchy while omitting format and per-row coverage
labels. The shared image route accepts only
strict V1-V5 presentation envelopes and otherwise fails closed without weakening
the deterministic text fallback.

V4 cards already in transcripts remain readable but do not expose the editor.
V6 does not change provider fallback text, pacing, or delivery ownership.

For this contract, the definitive pre-acceptance set also includes an exact
classified HTTP 404 `chat_not_found`; generic or unclassified 404 responses
remain outside the fallback path.

Same-route inputs accepted during a live inbound turn may update the reply
message, reaction capability, and idempotency inputs, but they must retain the
turn's thread binding and must not recreate an explicit-target override.
Exact-message reply and reaction authorization rechecks the accepted input
against that same thread binding.

## Implementation checklist

Before shipping any change that can send or shape an outbound message, answer these questions in code review:

- What reply is this flow trying to earn in the first three outbound messages?
- Does the first or second message ask a real question a recipient can answer easily?
- Does the flow stop, slow down, or change behavior when the recipient does not reply?
- Are outbound count, inbound reply count, last inbound time, last outbound time, line id, and delivery state available to the sender or scheduler?
- Are net-new conversations and bursts limited per line, not just globally?
- Are new lines treated differently from warmed lines?
- Are cold contacts with no reply in 30+ days protected from bulk re-engagement?
- Are shortened URLs impossible in this path?
- Are delivery failures and silent-drop signals able to suppress future sends?
- Could this template be sent identically to many recipients? If yes, what real user context makes it specific?

If the answer is unknown, do not assume the path is safe. Add the missing guard, state, or documentation before expanding volume.

## Murph Hosted Automation Engagement

Murph pauses model-capable automation wakes for Linq members with no inbound day in the last 28 days, using `hosted_linq_daily_state` as the conversation source of truth. Conversational replies are never gated by this pause because fresh conversation mailbox lag bypasses it. An accepted meal capture is an explicit member interaction and therefore member-wide qualifying engagement for the same 28-day policy, so the ordinary 9pm closeout needs no second opt-in and other due automations may also resume. This engagement evidence does not bypass AI-usage authorization or current route authority. Deterministic system-mailbox work can still run in bounded model-free mode when model work is blocked.

Linq egress should stay small and obvious:

- A recognized member who messages a direct Linq chat other than their current
  home chat receives an inbound-triggered, link-free redirect in that chat.
  Redirect identity is stable for the member, wrong chat, current home line,
  and provider occurrence UTC day: same-day inbounds and webhook retries
  converge, while a new inbound on the next UTC day or after a home-line change
  may produce a fresh redirect. There is no scheduled or proactive follow-up.
  Deterministic copy comes from at least one hundred distinct variants; every
  rendered variant shows the current home number and explicitly tells the
  member to resend the unprocessed message there.
- Participant-target first-contact egress is closed by default and has exactly three kind-specific authorities. Signup welcome remains tied to `signup-welcome:<memberId>`, the member's verified phone, and the assigned home line. Group-join outreach dispatch runs inside the shared bounded provider-fence primitive: the transaction holds the group-join drain and participant-contact phone locks, records the provider claim/outcome on `HostedLinqDelivery.groupJoinOutreachId`, and makes the Linq opener call before commit. Group-line recovery is admitted only for an active member whose iMessage group contacted that member's exact assigned hard-blocked Linq line; transport revalidates the member, assignment, hard-blocked incoming line, participant identity, healthy backup sender, and delivery intent before provider entry.
- A phone participant's affirmative reaction to an active group join offer creates at most one `HostedGroupJoinOutreach` for that offer and participant when the participant has no member identity or is a verified, unsuspended member without active hosted access who is not already in the target group. Active members keep the direct join path; suspended and existing target-group members are consumed without outreach. The drain keeps the existing global and participant-phone fences, takes an existing recipient's member row only when no concurrent authority transition owns it, locks that member's existing sponsored-access rows, and otherwise defers for one minute instead of waiting across the account-deletion lock order. Once that row is owned, the drain skips a recipient who is suspended, now active, or now in the target group, while an inactive unsuspended nonmember of that group continues through the unchanged opener path. The existing minute-level hosted-onboarding cron drains up to ten due rows per invocation and stops at the first non-sending outcome. Line selection reuses the shared proactive policy (`chooseHostedLinqSignupWelcomeLine`), which preserves the weighted direct/group 5,000-message soft target and the all-above-target least-planned fallback. Among genuinely new, non-preferred candidates below that target, it ranks exact trailing-168-hour message load before weighted planning load and today's new-conversation count. Recent load is derived through bounded indexed reads of canonical accepted deliveries plus inbound `message.received` provider events; each actual message contributes one, including group messages, and no counter, bucket, or backfill owns duplicate state. Outreach then claims capacity against a *reduced* limit: the signup-welcome limit (the lower of 50 and the line warmup limit) minus a reserve. Signup welcomes answer someone who has already joined and is waiting, so a fixed number of each line's daily slots is reserved for them and outreach cannot claim those. This is a finite reserve, not absolute priority: it guarantees that many later welcome claims per line, and enough activations after outreach has run can still exhaust the line and omit a welcome. A line still early in warmup can be reserved entirely for onboarding. Pacing is per line, not global: a line that dispatched inside its jittered one-minute window is excluded from selection, so throughput comes from using more healthy lines rather than from any line sending faster, and a small pool paces itself instead of bursting. A row keeps the line it first dispatched from only while that line remains usable. A pinned line inside its pace window is a wait; a pinned line that has left the healthy pool causes re-assignment, because the provider idempotency key is derived from the outreach id rather than the line, so a row is never stranded waiting on one unhealthy line. Jitter is derived from the row id, so a replayed dispatch keeps its schedule. The pre-provider delivery claim uses the ordinary reclaimable `attempted` status so a process death between the claim and the provider call replays under the stable idempotency key instead of stranding the row.
- Recipient quiet hours come from a calling-code table whose window is safe across every civil zone that code can represent. A region absent from that table is refused terminally as `recipient_region_unsupported`, never deferred: the inputs are a phone number and the clock, so a deferral would re-evaluate identical inputs forever. Widening the supported set is a data change to that table, and a test holds every region the hosted phone picker advertises to a finite outcome.
- Removing the reaction before dispatch revokes the outreach: the offer-participant row remains as the stable tombstone and a skipped delivery records `reaction_removed`, even when the removal arrives before its own delayed add, so the late add converges instead of sending. Removal crosses the shared outreach drain, so it either terminalizes before provider entry or observes the durable opener delivery; after dispatch starts there is no rollback, and the terminal delivery also stops a later re-like from opening a second thread. Reaction handling also marks the existing Linq provider-event row atomically with enqueue, revoke, disclosure, or join acceptance; only a duplicate carrying that terminal marker is skipped, so account deletion cannot turn an old provider event into new outreach while a marker-less interrupted event remains retryable.
- Group-join outreach sends one short, group-specific, link-free message whose shared handoff sentence says that replying starts the next step, chosen from a bank of one hundred genuinely different, reaction-neutral leads by digest of the row id so many recipients do not receive byte-identical copy and a replay composes the same body. The larger bank substantially reduces expected same-line repetition at the reduced per-line outreach limit, and the group name supplies further real context. Variation is real wording, never padding or synonym churn. It sends no automated follow-up: a participant who never replies is texted once for that offer. A reaction to a different offer is fresh intent and is not suppressed by an earlier attempt; duplicate work is collapsed by the unique offer-participant row, and volume is bounded by pacing, per-line caps, line health, and quiet hours. Only the recipient's inbound reply enters the existing first-contact admission path and earns the first-party group-aware signup link, and that link's authentication is restricted to phone because the invite is phone-bound. Reply lookup is nonterminal and delivery-derived: routing, capacity, admission, or suppression outcomes that send nothing leave the group context available for a later inbound, while any live or accepted group-aware signup delivery for the same outreach makes that exact context unavailable. The exact inbound retry is excluded by the event digest already present in its ordinary effect id, so its own pre-provider row cannot suppress recovery. A nonempty provider-native `reply_to.message_id` is authoritative and restricts recovery to the accepted opener with that existing `HostedLinqDelivery.messageLookupKey`; an unmatched explicit anchor returns no group context instead of falling through to a newer opener. Without a native anchor, the newest available opener remains the direct thread's conversational context. An exact provider chat match takes precedence; if Linq accepted chat creation without returning a chat id, the fallback requires the same participant and the exact selected sending line observed as the inbound recipient. Generic signup delivery remains one member/day identity, while a group-aware reply adds the exact inbound event digest to its provider key; different group replies are independently answerable and never compete for one delivery identity. `HostedLinqDelivery.groupJoinOutreachId` and `groupJoinReplyOccurredAt` keep the direct outreach relation and exact reply time for replay; `sourceRef` remains the ordinary effect id. Before provider correlation, the original webhook owns recovery of that immutable event intent: a retry inside the shared 15-minute ambiguity window receives a retryable server response, and Linq's documented [webhook delivery guarantee](https://docs.linqapp.com/guides/webhooks/#delivery-guarantees) retries 5xx responses over approximately 25 minutes, crossing that threshold. After the window the same event reclaims its stored outreach, target, template, provider idempotency key, occurrence time, and direct outreach relation. A later event has a different key. Provider correlation is the non-reclaimable boundary. Provider acceptance also sets the shared member/day accepted-signup fact, so a later ordinary same-day inbound cannot replace the intended group destination with a generic link; a distinct unconsumed group reply still bypasses that daily gate under its own exact identity. A newly planned generic dispatch rechecks that marker while holding the member lock, so a concurrently accepted group-specific link wins; an already-persisted ambiguous intent still replays under its stable provider idempotency key. Group failure never clears the shared fact because it may represent another accepted link; delivery state alone reopens only the failed outreach context. A group-aware signup effect holds the existing outreach drain across its bounded provider request, accepted delivery correlation, and shared daily-marker projection. Its provider deadline covers response-body consumption; transaction-local lock waits are bounded, and provider entry is refused unless the full request timeout plus correlation/commit margin remains. A pre-provider refusal rolls back for webhook retry. Account deletion suspends the group runtime and crosses that same drain with a strictly longer transaction budget before suspension commits: a reply or opener that already owns the drain finishes its provider-correlated outcome before teardown, while every later send observes the committed suspension and stops before provider dispatch. Provider failure commits the existing exact delivery recovery consequence before webhook retry. For the fenced path, the accepted milestone is the sole writer of the shared daily marker, so a buffered terminal failure cannot be overwritten by legacy post-send bookkeeping. No new delivery owner or retry lifecycle is introduced.
- Activation and Linq routing serialize only the member's durable row, then read and reserve proactive capacity while choosing the home line. Linq route ownership uses `FOR NO KEY UPDATE`: it still conflicts with activation and another route owner, but remains compatible with the `KEY SHARE` taken by Telegram, Linq, or another channel's mailbox foreign-key insert after updating the shared routing row. There is no separate per-member route advisory lock. Planning load is derived on demand as `10 * active direct members + 25 * provisioned Linq group routes`, with group routes attributed by the blinded account projection written atomically with canonical encrypted route authority. Lines below 5,000 planned messages are preferred; when all daily-eligible healthy lines are at or above 5,000, the least-loaded line remains assignable. Null legacy projections are visible as incomplete coverage and conservatively prevent claiming exact spare capacity until the one-shot backfill completes. A degraded-line first-contact fallback carries the selected line snapshot into the webhook planner and claims its capacity only after the final member route and `createHostedLinqChat` sending line agree. `HostedLinqLine` owns the current UTC day and proactive-conversation count; the effective per-line limit is the lower of 50 and any configured `maxNewConversationsPerDay` warmup limit.
- The 5,000 planning target is not a send cap. A healthy line contacted by a member-initiated first inbound keeps that conversation on the contacted line without consulting planning load or proactive pacing; weighted selection applies to proactive placement and genuinely degraded-line fallback. Planning must never block inbound group creation, inbound messages, current-conversation replies, or least-loaded direct placement. Linq's 7,000 combined inbound-plus-outbound messages per line per UTC day remains the provider guideline and is observed separately through line-keyed provider events and outbound deliveries; this policy adds no 5,000 or 7,000 runtime rejection path.
- A capped preferred line falls through to another healthy assignable line. A lost atomic claim is retried once for a day-rollover race, then activation tries another eligible line inside the same request. If every healthy line is at its proactive limit, activation still assigns a home line but omits the signup welcome. This preserves the onboarding “Text Murph” path without exceeding the line cap.
- A member-initiated first text or existing-thread reply on the incoming line does not claim proactive capacity. If that line is degraded and the response must open a participant-target chat from another line, the fallback line must atomically claim capacity; when no fallback has room, web accepts the inbound event without starting that new chat.
- A recognized member's iMessage group inbound on their exact assigned `AT_RISK` Linq line stays on the ordinary canonical group route because the member initiated that group. If the exact assigned managed incoming group line is hard-blocked, Web must not send from it, mutate the group roster, or create route-transfer state. Instead, the triggering active member gets one private, link-free recovery instruction from a healthy proactive line selected through the existing line policy and daily capacity counter at transport time. The recovery id is stable for the member, hard-blocked incoming line, and group thread, while a safe source ref distinguishes exact provider events. Any live or successful attempt remains the tuple-wide convergence point, so repeated source events do not repeatedly prompt. A provider-correlated failed receipt is not irrevocably final because a later delivered receipt may win; only a different source event may use one of five bounded provider attempt keys after failure. That attempt must reuse the exact same pinned sender, rendered backup number, deterministic copy, and original proactive-conversation capacity reservation. The pinned line remains eligible when healthy, or while its `warning` projection's latest receipt event is exactly the failed delivery's hashed last-provider-event identity. A newer receipt, provider degradation or hard block, disabled or unconfigured egress, unreadable phone envelope, or any other unhealthy state fails closed instead of searching the general line pool. Replay of the exact failed event cannot send again. A late success may therefore duplicate only the same recovery instruction, never introduce a conflicting backup number or consume another capacity slot. Every reviewed variant must show the selected Murph number and tell the member to add it inside the existing group chat, then retry the intro.
- An explicit request for Murph's iMessage number in a private direct Telegram turn may assign a bare home line without sending a message or claiming proactive capacity only after Web proves the member has an exact verified phone that Linq inbound can resolve to that same member; a verified account email alone is not proof of the active iMessage sender. Without that phone, Web assigns nothing and the assistant points to the existing account-settings connection step. A successful result includes only the masked verified-phone hint, and the assistant must say to start the first iMessage from that phone and that same-account recognition is not guaranteed for another number or email and may produce a separate Murph conversation. The hard guarantee is one Murph line per member; continuity is supported only for that disclosed sender, not for an arbitrary iMessage identity. The signed tool request, rather than Telegram wake or persisted assistant-input metadata, owns both existing-number reads and first assignment. Web must authenticate the current assistant input, lock and reread the member route, return `linqRecipientPhone` first, and consult the pool only for `none` route authority. Pending or chat-bound authority fails closed. The tool accepts no caller-selected member or number, and the assignment commits with the route read so repeated or concurrent requests cannot consume extra lines.
- A model-admitted instant-start invite is the single-owner token for the exact original inbound, not a send target or follow-up continuation. Only a transaction whose unique phone-identity insert creates a genuinely new member may mint it; if another inbound wins that insert while classification is pending, the loser retries before invite or accounting work and the signup path remains authoritative. While the token remains attached, another inbound for the inactive member exits retryably before line counting, invite issuance, or delivery. Stripe provisioning and activation serialize on the existing member row, revalidate the exact invite and admission event before provider mutation, and clear the token atomically with activation. Ordinary signup delivery keeps its existing exact-invite and member-ownership checks.
- Instant-start activation commits its `member.activated` mailbox item before the original conversation is replanned, but defers that activation signal as an explicit request-local continuation. Web starts the foreground prewarm, appends and signals the original conversation first, then runs the activation continuation so its group-join reconciliation still occurs. Once Web receives the continuation, a later caught failure runs it immediately. A process death leaves the activation item durable, but recovery is provider-owned: Linq begins retry handling only after its 10-second timeout, does not specify the first retry delay, and may take minutes to redeliver; that exact-event retry's ordinary active-member wake reconciles the item. After provider retry exhaustion, only later member traffic supplies another wake and that delay is unbounded. This ordering adds no queue or second wake authority.
- An unknown phone contacting a degraded line is materialized as the inbound member identity before the final fallback claim so web can re-read any concurrently created route authority. If the claim is rejected, that identity remains durable, but web creates no home or pending route, invite, delivery, fallback chat, or line-count increment; later inbound resolves the same member and retries normal routing.
- After Linq accepts that canonical participant welcome, its signed delivery outcome must atomically promote the returned direct chat into the Web-owned home route. Manual dashboard sends and generic provider `message.sent` events remain observability-only and must not bind or retarget a member.
- A terminal HTTPS URL on an existing Linq chat is sent as a provider-native link part, with no generated opener or filler text. Caller-supplied leading text remains its own preceding text message. Because the provider returns one receipt identity per message, both identities stay ordered beneath the existing `HostedLinqDelivery` owner: the link is the final scalar result for compatibility, cleanup receives every accepted identity, any failed part fails the logical delivery, and the logical delivery is delivered only after every part is delivered. A retryable or transport-ambiguous link response is reconciled once with the exact same `:link` request and provider idempotency key; a definitive rich-link rejection falls back to the original URL as ordinary text under a stable `:fallback` suffix. The link request must not begin until the successful primary response includes its provider identity; an identity-less primary response retries the same primary key and cannot become a link-only checkpoint. If every post-primary link attempt fails before acceptance can be confirmed, the accepted primary identity becomes a recoverable checkpoint rather than a completed reply. The assistant outbox remains retryable with confirmation promotion disabled, keeps that non-confirmability sticky across later ambiguous primary or required-callback failures, re-enters the same primary and `:link` provider keys, and relies on Linq idempotency to return the primary identity without accepting duplicate text. Web consumes the answered mailbox rows only after a two-identity recovery or the stable text fallback is accepted, and only a recovered response whose primary identity matches the checkpoint may supersede it. Two-part group sends persist their route directness on the existing delivery owner and derive every nonterminal aggregate from that immutable fact, so they retain `sent_no_receipt_expected` even when a failed child receipt is superseded and do not enter direct-message missing-receipt warnings; failed or fully delivered children still advance the parent terminally. The child rows contain only privacy-safe lookup keys and bounded suffixes; they do not create a second retry or delivery lifecycle.
- Thread sends use same-user route authority as target context when it matches the requested thread, otherwise they fall back to the member's durable home or pending Linq route.
- The Web Linq egress owner resolves the canonical delivery target and direct/group audience at send time. Stored automation routes are bounded authority evidence, not a second route-ownership system.
- Proactive current-home fallback sends do not inherit replay-scoped route authority or inbound context; reply-anchored sends keep their matching inbound context.
- Egress no longer owns a separate "recent inbound" recency check; hosted automation recency belongs to reconciliation/wake selection.
- Typing indicators do not call web-owned egress assertions. They are locally throttled to one session per chat, capped at five minutes, with a restart cooldown after a max-length session.
- On the Linq instant-start path, web fires one best-effort typing start on the inbound chat right after the planner transaction creating the member commits, so a first-ever message is not met with a silent chat while the cold runtime boots. It is a one-shot feedback hint with a short timeout, no retries, no egress assertion, and no effect on webhook handling; on the success path the runtime's own typing session and reply supersede it. If the webhook instead fails after the hint started, web chains one best-effort typing stop behind the in-flight start and registers it with the request's post-response scheduler so the cleanup survives the error response; the later webhook retry starts fresh, and a rare redelivery racing the stop only loses its pre-runtime hint, which the runtime's own typing session re-establishes.
- Delimiter-generated Linq reply bubbles send the first bubble immediately, then pause 1.5 seconds after each confirmed sibling send. The pause applies only within that reply's existing outbox sequence; it does not pace unrelated sends, retries, reactions, or progress updates.
- A terminal HTTPS URL may be sent as Linq's native link-only rich-preview part. An unselected existing-chat link-only message, including a payment URL, remains one provider message with no added text. A selected link-only native reply stays one ordinary text message because Linq requires text to carry `reply_to`; it does not trade away the selected target for a preview. When caller-supplied text or media precedes the URL, the existing local or hosted egress owner accepts that primary message first and then sends the link-only preview under the same delivery's deterministic `:link` idempotency-key suffix. The final accepted provider message id remains the scalar compatibility result while the ordered identity list owns cleanup and receipts. Hosted primary requests retain half of the existing ten-second provider budget, while the link half is split across an initial request and one same-key reconciliation attempt. New-chat creation may use that two-step flow only when the caller supplied URL-free text or media for the required first message; link-only, multi-URL, or other URL-bearing first-message input must fail before provider entry instead of inventing or leaking opener copy. Reaction-bound messages keep their URL nonterminal and stay one provider message. In existing chats, embedded, other nonterminal, non-HTTPS, credentialed, and oversized URLs remain ordinary text.
- An ordinary automatic model reply stays flat even when its delivery context carries an inbound message id. For automatic model responses, Murph requests a native reply only through `murph.select_reply_target`, and every delimiter-generated bubble from that response targets the same accepted message. This changes thread placement, not message count or pacing, and does not change explicit or manual low-level reply calls. Exact-message reactions continue through the separate existing reaction effect and do not select the text reply target.
- Hosted native reply and app-card delivery may use raw direct-recipient details only from the invocation-local decoded delivery context. A conversation input admitted into an already-running turn carries that same ephemeral context into the existing delivery owner; durable assistant input remains blinded and no recipient lookup or second route owner is introduced.
- Do not restart typing between reply bubbles. Linq clears the turn's existing indicator on send, and repeated typing cycles add line activity without proven deliverability value.

## Prompt and copy guidance

Preferred shape:

- short, conversational, and specific to the recipient
- one clear question when Murph needs to build trust or confirm intent
- clear continuation of an existing user-requested thread
- full recognizable URLs only when links are necessary
- calm, non-salesy language

For a provider-authenticated direct iMessage that the person initiated, answering the original question in the same thread is preferable to opening with a signup link. Instant-start eligibility must stay same-line and inbound-only; if line assignment would move the conversation, the ordinary explicit signup-link fallback remains safer than proactively opening a new thread from another number.

High-risk shape:

- "Here's your update" followed by a link as the first contact
- repeated reminders that never ask the user to confirm, pause, or adjust
- batches of identical copy
- shortened links
- marketing, acquisition, referral, or signup pressure
- exact-send instructions in provider prompts that make the assistant behave like an automated outreach tool

## Review guidance for agents

When reviewing or editing a messaging path, look across the whole flow, not just the template. A safe message can still be unsafe if it is sent too often, too late, from a cold line, through a flagged line, or into a thread with no replies.

A complete review should inspect:

- prompt text and system instructions
- message generation helpers and templates
- scheduler, retry, queue, cron, and batch code
- line selection, warmup, and contact-card setup
- delivery receipt ingestion and suppression behavior
- cold-contact and inactive-thread handling
- tests or fixtures that prove the guardrail

If a path lacks line-level pacing, recipient reply tracking, or delivery-health suppression, treat that as a deliverability risk even if the copy itself looks fine.

#### Reciprocity Is Continuous

Design messaging flows to earn genuine replies early, then keep letting current replies set the pace. Historical engagement is useful context, not permanent permission to continue proactive outbound after someone has gone quiet.

- Ask natural, relevant questions when an answer would genuinely help the conversation.
- Avoid one-way broadcast patterns. When replies stop, combine related reminders, slow down, and eventually pause nonessential proactive messages.
- Do not require ritualized replies such as "YES", "done", or "skip" merely to manufacture engagement.

#### Volume and Pacing

- Stay under 50 net new conversations per day per line. This is the safe zone. Above this, Apple starts paying closer attention.
- Do not burst. 20 messages in 1 minute looks different than 20 messages over 1 hour, even though the daily total is the same. Spread sends across the day.
- If you need higher volume, use multiple lines and distribute conversations across them. Do not stack everything on one number.
- Ramp new lines gradually. Do not go from 0 to 200 messages on day one. Start with 10-20 per day for the first week, then increase.

#### Content

- Vary your message content. 20 identical messages to 20 different people is a spam signal. Even small variations, such as using the recipient's name or changing phrasing, help.
- Avoid shortened URLs, such as bit.ly or tinyurl. Apple flags these. Use full URLs or your own domain.
- Do not pad messages with random text to fake variation. Apple's ML detects this pattern. Artificial variation is worse than no variation.
- Keep messages conversational. The more your messages read like a human texting a friend, the less likely they are to trigger detection.

#### New Lines and Onboarding

- New lines have low trust with Apple. Treat the first 2 weeks as a warmup period: lower volume, higher-quality conversations.
- The worst thing you can do with a new line is send a burst of messages and then go silent. Apple interprets "activity then silence" as a spam account that got caught. Consistent, low-volume usage is better.
- If possible, have real inbound conversations on new lines early. A line that receives messages before it sends them builds trust faster.
- Set up a contact card with `POST /v3/contact_card` on every line. When recipients save your contact, Apple bypasses spam checks for that sender permanently.

#### What to Avoid

- Never send to purchased or scraped contact lists. A single spam report from a recipient can trigger an account block.
- Do not use the same line for both automated and manual messaging without rate awareness. Automated systems can easily exceed safe thresholds.
- Do not re-engage cold contacts who have not replied in 30 or more days with bulk messages. Apple tracks recipient engagement per chat: a thread with 50 sent and 0 replies is a red flag.
#### Monitoring Your Line Health

- Keep three provider/local facts independent: Linq line service
  (`ACTIVE`/`FLAGGED`), Linq line reputation
  (`HEALTHY`/`AT_RISK`/`CRITICAL`), and Murph-observed delivery health from
  receipts and failures. A successful receipt must not erase provider
  reputation, and a provider warning must not masquerade as a local failure.
  Service and reputation also keep independent provider ordering metadata:
  missing, null, or unrecognized values never clear the other dimension.
  Current Web code does not advance the legacy generic provider
  status/timestamp/event triplet; it remains a coherent prior-build
  compatibility snapshot until the post-drain contract migration consumes it.
- Keep Linq chat health as a content-free latest-state projection keyed by the
  blinded chat identifier. Webhooks are the fast path; bounded inventory
  reconciliation repairs missed or silence-driven changes without calling Linq
  from a routing transaction.
- Existing routes remain sticky on `AT_RISK`; new assignments avoid those
  lines. Scheduled turns may receive only a closed cautious/recovery posture,
  while the existing Web egress authority rechecks hard blocks immediately
  before the existing provider-dispatch fence.
- During rollout, predeploy adds and backfills the independent provider fields
  but leaves legacy delivery health conservatively blocking old Web builds.
  The existing post-drain contract-migration lane reconstructs local delivery
  health from receipt evidence only after the replacement build is live. That
  cutover makes the replacement Web revision the rollback floor; recover by
  redeploying it or a later compatible revision, never a pre-cutover build.
- Watch delivery receipts on receipt-capable protocols. If iMessage messages show as "sent" but never "delivered," Apple may be silently dropping them. SMS/MMS do not produce delivered/read receipts, so `message.sent` is their highest positive provider signal and must not be presented as handset delivery.
- If you see delivery failures spike on a line, reduce volume immediately. Do not keep sending; you are making it worse.
- If a line gets flagged, stop all automated sending on it immediately. Continued sending on a flagged line can escalate from temporary throttle to permanent block.
- Contact the provider if you suspect a line is flagged. They can check the line health status and help with recovery before it becomes permanent.

#### Engagement Can Change

A chat that was once active can become one-way later. Treat Linq's current chat-health status and Murph's current inbound/outbound pattern as live evidence, and never assume that an old reply count permanently clears future automated sends.
