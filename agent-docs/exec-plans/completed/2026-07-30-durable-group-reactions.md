# Make every group reaction durable room evidence

Status: completed
Created: 2026-07-30
Updated: 2026-07-31

## Goal

- Make every provider-authenticated participant reaction on a Murph group
  message durable enough for the silent group-room-model automation to read it
  independently of any later chat message.
- Preserve Linq affirmative-reaction reply behavior while retaining laughs,
  dislikes, emphasis, questions, custom emoji, removals, Telegram per-user
  deltas, and Telegram anonymous count snapshots.
- Remove reactions from the lossy newest-ten next-message buffer without adding
  another queue, table, journal, wake kind, or runtime state owner.

## Success criteria

- A valid Linq non-affirmative reaction or removal appends one idempotent
  `conversation.message` mailbox row immediately and signals the existing
  runtime.
- Existing Linq affirmative additions remain normal durable inbound messages;
  provider retries can replay their downstream idempotent projection.
- Telegram `message_reaction` updates retain every added and removed reaction;
  `message_reaction_count` updates retain the complete aggregate snapshot,
  including empty snapshots, standard emoji, custom emoji, paid reactions, and
  bounded future reaction kinds.
- Reaction mailbox rows are marked consumed in the same transaction that
  appends them. The ordinary mailbox importer therefore retains an
  `AssistantInputEvent` but never admits a reaction-only reply turn.
- Group-room-model maintenance merges those durable reaction inputs with
  committed group transcripts inside its existing seven-day evidence bounds.
- Member memory, direct chats, self echoes, untrusted replyable marker text, and
  rooms without current route/access authority do not enter reaction evidence.

## Architecture

```text
provider-authenticated reaction webhook
  -> ordinary conversation.message envelope
  -> existing encrypted hosted mailbox
  -> mark exact row consumed at ingress
  -> existing mailbox import / AssistantInputEvent
  -> group-room-model maintenance evidence
```

The consumed-row bit is the existing context-only primitive. It keeps mailbox
idempotency, checkpoints, retention, encryption, and replay ownership unchanged
while preventing any reaction-only assistant response. The shared bounded
`murph.hosted-group-reaction.v1` text envelope is data, not an instruction or a
new persistence format.

Linq positive additions still enter the established synthetic message path so a
heart or like can acknowledge a direct question. All other Linq reactions use
the consumed path. The old pending reaction buffer remains available only to
unrelated participant-event context until its own owner is simplified.

Telegram requires the bot to be an administrator and the deployed webhook to
include both `message_reaction` and `message_reaction_count` in
`allowed_updates`; Telegram excludes them from the default update set.

## Constraints

- No schema migration or additional Postgres model.
- No new mailbox kind, lane, workflow, alarm, cursor, retry loop, or container
  lifecycle.
- Provider event id is the mailbox idempotency source.
- Target text is useful but optional; a provider target-read failure must never
  discard the reaction itself.
- Reaction evidence is bounded by existing assistant-input text retention and
  the room automation's seven-day/entry/byte limits.
- Telegram webhook authentication proves the room event, not a reactor's Murph
  identity, so individual Telegram reactions remain unattributed.
- Raw participant handles may attribute evidence during one maintenance run but
  may not be copied into the saved room-model page.

## Verification

- Hosted-execution reaction envelope round-trip and bounds.
- Web mailbox append-plus-consume idempotency.
- Linq type/removal/custom-emoji durability, target-read failure, authority
  rejection, signal failure, and duplicate provider replay.
- Telegram individual deltas, anonymous snapshots, empty snapshots, custom,
  paid, future reaction kinds, route/access rejection, duplicate replay, and
  route-level webhook bypass.
- Assistant maintenance evidence with production-shaped blinded local thread
  identities, no later chat turn, affirmative fallback, transcript dedupe,
  member-memory exclusion, and trust-boundary rejection.
- Run focused owner suites, package/web typecheck and lint, diff-aware tests,
  exact-head CI, ReviewGPT, and final patch inspection.
Completed: 2026-07-31
