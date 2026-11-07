# Typing means the answer is coming

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Goal

Web puts an "on it" emoji tapback on a direct iMessage within about a second.
The runner then shows the typing bubble for the rest of the wait. The two say
different things at once: the emoji says "I'm on it", and the bubble says "words
are being written now". A long bubble followed by a short reply reads as false.

One signal at a time. The tapback covers the wait; typing means the answer is
coming. Typing stays on by default. Only a turn with a confirmed tapback changes.

## Success criteria

- A turn with a confirmed tapback shows no bubble until its final answer starts,
  or until about 30 seconds into the wait.
- A turn with no confirmed tapback still gets early typing, including photos.
- Reply delivery time does not change, and no typing work can hold a delivery lock.
- No bubble outlives the reply.
- A slow runtime still alerts.

## Product behavior

- **Confirmed tapback on the current burst:** hold typing. Start it when the
  final answer starts, or at the 30-second fallback, whichever is first.
- **No confirmed tapback:** typing as today. Hard news deliberately gets no emoji.
- **Telegram, SMS, groups, local runs:** unchanged.
- **Progress notes:** a tapback suppresses a note only during the first 30
  seconds after its claim, not 2 minutes. Late notes are the ones a slow turn needs.

## The signal

Tool work and messages are separate stream items. `item/started` for an
`agentMessage` carries `phase` before any text: `commentary` for an interim line,
`final_answer` for the reply. A live `codex app-server` probe showed this order on
the production model with the pinned 0.166.0 release and with 0.167.0. The repo's
Codex patch does not touch this path. The probe used the published release, not
the patched runner build, so a real turn must confirm it after deploy.

Today `assistant-codex-events.ts` normalizes that empty-text event to `unknown`,
so Murph drops it. Codex documents that providers may omit `phase`; missing means
unknown, and the fallback covers it. `first_codex_text_observed` is not this
signal: it fires on a completed message and counts commentary.

## Design

1. **Final-answer event (engine).** Normalize `item/started` for an `agentMessage`
   with `phase: "final_answer"` into a dedicated text-free event. It produces no
   trace, progress or reply text. It passes through the existing accepted-event
   boundary and honors suppressed and no-reply delivery contexts. Do not reuse
   `onFirstAssistantResponseCompleted`, which owns turn admission.
2. **Deferred start lives in the typing handle (engine).** Extend the handle from
   `startAssistantChannelTypingIndicator` to own the deferred start, the deadline
   and the release signal, so `local-service.ts` gains no second set of flags.
   One gate per turn, across provider retries and steers, with one deadline:
   - wait about 500 ms after the first typing request, because a warm turn can ask
     before the tapback confirms. This delays the default bubble, so keep it short.
     Receipt time is not available at this seam, so the fallback deadline counts
     from the same request;
   - ask once, bounded at 1 second; only `ackCovered === true` holds. Anything
     else, including an error or timeout, starts typing as today;
   - when held, release on the final-answer event or the fallback deadline;
   - start at most once, and latch closed synchronously when a terminal outcome is
     known, including between reply delivery and turn finalization.
   Nothing here may be awaited by provider start, tool execution or delivery.
3. **Cleanup after the reply (engine).** A successful delivery ends with
   `providerStop: false`, which assumes the reply cleared the bubble. A typing
   start that overlaps the reply breaks that. Direct iMessage turns therefore
   always send a real provider stop after the reply, detached from delivery. Keep
   the hosted per-chat claim guard so it can never cancel a successor's typing.
4. **Attachment preparation (runtime).** Direct inputs needing attachment evidence
   start typing during mailbox import, before provider start. That path must use
   the same gate: one decision, one deadline, one provider start, carried through
   the existing preparation handoff. No confirmed tapback keeps today's early
   typing and existing cancellation behavior.
5. **Coverage read (Web).** Runner typing calls Linq directly, so Web cannot gate
   it. In the engagement route, recognize exactly `authorityCheckOnly: true` with
   `deliveryPurpose: "typing"` before the delivery transaction. Compose it from the
   existing route-ownership checks and the burst coverage query. It takes no
   delivery lock, runs no first-turn repair, writes nothing, and confers no send
   authority. It is burst-level, because a merged turn can target a later message
   than the one tapped. It returns uncovered when `HOSTED_LINQ_ACK_REACTIONS` is off.
   Every other path through the route keeps its locks and order.
6. **Result projection (Cloudflare).** `parseHostedRuntimeLinqRecentInboundEngagementResult`
   copies known fields, so it must preserve `ackCovered`.
7. **Coverage windows (Web).** Parameterize `isHostedLinqAckReactionCoveringCurrentBurst`:
   30 seconds for progress suppression, the existing 2-minute burst age for typing.
   Burst deduplication is unchanged.
8. **Alert (Web).** `typing-alert-monitor.ts` would fire on every held turn. For
   direct Linq turns, select one measurement endpoint: the earlier of typing and
   provider start. Use it consistently for eligibility, silence bounds, reply
   suppression and elapsed time. Keep actual typing timestamps separate for
   conversation activity and `typingAcceptedAt`. Record the endpoint in the frozen
   alert details and wording. Telegram is unchanged. No per-turn hold marker is needed.

## Failure modes

- **Tapback confirms after the single read.** Bubble and emoji both show, as today.
  Accepted, including slow photo classification on a warm runner.
- **Final-answer event never arrives** (missing phase, media or card reply, a turn
  ending without a reply). The fallback covers a long turn; a short one gets the
  reply with no bubble.
- **Web read slow or down.** Typing starts as today, a little later.
- **Linq typing itself fails on a direct turn.** The alert no longer catches this,
  because it now measures runtime start. Accepted: the alert exists to catch slow
  runtime, and reply monitors are unchanged.

## Deploy and skew

Web first, then runner: merging deploys Web; the runner ships by manual dispatch.

- **New Web, old runner:** never sends `typing`. Turns behave as today. The alert
  endpoint and the note window apply immediately, which is safe.
- **New runner, old Web:** the old route accepts an unknown purpose and returns no
  `ackCovered`, so turns are not held. Old-route locking is the skew risk, so Web
  must be fully rolled out first.
- **Rollback:** redeploy the previous runner. Turning `HOSTED_LINQ_ACK_REACTIONS`
  off returns uncovered; holds already latched drain through their release conditions.

## Rejected alternatives

- **Delay typing on every turn.** Hard news and quick follow-ups would show only a
  read receipt for a long wait.
- **Web stops typing after the tapback.** Web does not own the runner's refresh.
- **A fixed delay.** It guesses; the stream event is exact.
- **Rely on progress notes for long waits.** Most slow replies have no earlier
  message, so a timer is the dependable fallback.
- **A per-turn hold marker for the alert.** See plan review finding 5.

## Plan review (ReviewGPT, mountain, 2026-11-06)

Response: `audit-packages/plan-typing-after-tapback.md`. Each claim was checked
against the code before disposition.

1. **P1, the authority-only route is not read-only.** Accepted. It takes both locks
   and can run first-turn repair, which writes the `attempted_at` burst boundary.
   See design 5.
2. **P1, a late typing start can outlive the reply.** Accepted. See design 2 and 3.
3. **P2, attachment preparation starts typing before provider start.** Accepted,
   with one decision rather than a retry at provider start. See design 4.
4. **P2, the alert needs one selected endpoint.** Accepted with a simplification:
   the earlier of typing and provider start for all direct Linq turns, not only held
   ones. This measures what the alert exists for and needs no classification. The
   cost is the typing-failure case listed above.
5. **P2, a best-effort hold marker can lose to an immutable alert.** Not applicable
   after finding 4: there is no marker, so no race, no new stored leaf and no skew.
- **Details table.** All accepted: strict `ackCovered === true`, the Cloudflare
  projection, the flag-off read, two coverage windows, and checking the pinned
  build. The pinned release was probed; the patched build is confirmed after deploy.

## Implementation review (2026-11-06)

Parent review of the build, before PR:

- The 500 ms wait replaced a 1.5-second wait from the first typing request, which
  delayed the default bubble on every no-emoji turn.
- `stop` shares one promise, so final cleanup still waits for an early stop.
- The route uses the feature's own setting and drops a per-turn chat-health read.
  Tapbacks only exist on direct iMessage, and the runner asks only for those.
- The Postgres proof uses the shared local-host check, not a fixed database name.

Read-only Codex deep review:

1. **A start overlapping the reply can outlive it.** Accepted, reproduced against
   the handle. See design 3. Simpler than tracking overlap, at the cost of one
   provider stop per direct iMessage turn after the reply.
2. **A pending start loses its refresh after a progress note.** Accepted; a
   regression on the default path. A pending start keeps its refresh; a held gate
   returns at once.
3. **A failed turn can start typing during failure persistence.** Accepted for the
   terminal `catch`. Not applied at `failed_terminal`, which can still recover into
   another provider request: closing there could lose typing on a turn that
   continues. The narrow window before the catch can flash a bubble, and the
   catch's stop clears it.

## Verification

- Normalizer: each `phase`, missing phase, and no reply text from the new event.
- Handle: covered, uncovered, error, timeout, final answer before the read returns,
  fallback firing, stop during every wait, one start across retries and steers.
- Cleanup: provider-visible state for late acceptance after the reply, terminal
  delivery while coverage is pending, stalled finalization, and a successor claiming
  the same chat, with delivery completion time unchanged.
- Attachments: covered plus slow preparation shows no bubble; uncovered still starts
  early; one decision and one deadline across handoff; cancellation at each stage.
- Route: with a coverage read stalled, a final reply for the same chat proceeds and
  neither lock is held; a stale first-turn reservation is unchanged field by field;
  coverage from a tapback on an earlier message of a merged turn; foreign chats,
  groups, participant targets and unsupported services get nothing.
- Postgres: the 30-second note window and 2-minute typing window.
- Alert: provider start at 2 s with typing at 30 s stays quiet; provider start at
  4 s with a reply at 5 s and no typing alerts; silence resets, group, Telegram,
  pre-webhook and isolation fixtures keep their results; a held turn gives no typing
  coverage to another input.
- After deploy: a real phone check of a tapback turn, a quick follow-up and a long
  turn, and one trace confirming typing tracks the final answer on the runner.
Completed: 2026-11-06
