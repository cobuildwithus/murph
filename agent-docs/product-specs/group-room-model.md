# Group Room Model

Status: implemented
Last verified: 2026-07-25

## Outcome

A hosted group runtime can accumulate a compact social cheat sheet that helps
Murph participate with better callbacks, timing, and continuity across long
conversations. The page is deliberately advisory: Murph reads it only when a
specific social detail would materially improve the current reply, uses a few
relevant tips, and otherwise ignores it.

## Product behavior

- Each synthetic group vault owns at most one active derived knowledge page:
  `group-room-model`.
- The page may summarize room voice, participant-specific social patterns,
  active canon and running jokes, Murph response patterns that landed or
  flopped, open loops, and explicit boundaries.
- It is a rough list of likely useful tips, not canonical truth, room settings,
  consent, or action authority.
- Ordinary group turns do not read the page by default. Murph may read it once
  when a person-specific callback, running joke, open loop, or learned room
  preference would materially improve the reply.
- Murph skips the read for simple factual answers, urgent or sensitive moments,
  live volleys where delay hurts, or when the current conversation is enough.
- Current messages, explicit room settings, safety rules, the group decision
  ladder, and current authoritative tool results always win.
- An explicit request to remember, correct, or forget group-local social
  context may rewrite the page in that same turn. Ordinary reactions and banter
  do not trigger immediate writes.

## Consolidation

The existing hosted overnight-memory maintenance lane is reused rather than
adding another scheduler or workflow. In a non-direct runtime, managed-seed
composition substitutes the group-room-model instructions under the existing
maintenance automation id. The existing private/direct seed path remains
unchanged.

The group seed runs at 04:00 local time on Tuesday and Friday, producing
alternating three- and four-day gaps. It uses fresh continuity and the existing
silent, isolated, preemptible, exact-skip maintenance execution contract.

The maintenance turn:

1. receives only bounded committed group transcript evidence from the trailing
   seven days;
2. reads the fixed page once when it exists;
3. fully rewrites that page only for a material improvement; and
4. otherwise performs no write and returns the required private skip result.

A full replacement owns deduplication, contradiction repair, and decay. There
is no append-only nightly diary, last-processed cursor, second pruning job, or
additional state store.

## Evidence

The evidence builder reuses committed assistant transcripts. It does not add a
raw-message table or rebuild a second message model.

For group vaults it preserves the existing structured transcript layout,
including `Input N`, `Sender:`, message text, reply context, reaction context,
and Murph's delivered replies. Exact route-authorized sender handles may remain
in the bounded maintenance evidence and the resulting group-local page as
internal identity anchors.

The personal-memory profile retains its existing flattened 2 KB-per-entry and
96 KB-total behavior. The group profile keeps structure, permits larger
coalesced transcript entries, and is bounded to 400 entries and 256 KB total.
Direct sessions are excluded from group evidence and non-direct sessions are
excluded from personal evidence.

## Identity and authority

An internal sender handle on the room page is only a social-continuity key for
that same group. It must never be:

- rendered to the room;
- used across groups;
- treated as preferred-name authority;
- treated as membership, group-share, account, routing, or action authority; or
- substituted for live `participantId` and current tool authority.

The page may say that the room teases Jimmy about something without claiming
that Jimmy enjoys the bit. Enjoyment requires its own evidence, such as Jimmy
reusing the joke, asking for it, or reacting positively.

## Page quality

Prefer observable behavior over psychological interpretation. Strong evidence
includes repetition across days, direct replies, reactions tied to the exact
message, human reuse, commissioned bits, and explicit corrections. One clear
signal may be retained as tentative. Silence is weak evidence.

Keep the page compact enough to skim. Preserve useful wording, merge duplicate
claims, update contradicted conclusions, retire completed open loops, and
remove stale material. Do not copy transcripts.

Do not store sensitive health, medical, sexual, relationship, financial, legal,
credential, payment, or precise-location disclosures on this page.

## Style ownership

Tone, Voice, Humor, Push, Detail, and Unhinged remain explicit settings owned by
the synthetic room runtime. Consolidation may observe that a response pattern
lands, but it must never silently mutate those settings or create a parallel
style owner.

## Architecture

This feature reuses:

- managed automation seeding;
- the existing overnight maintenance id and cron execution lane;
- committed transcript persistence;
- derived knowledge `show` and full-page `upsert`;
- prompt cache/fingerprint ownership; and
- the synthetic group vault boundary.

It adds no database table, queue, scheduler, vector store, raw-message replica,
participant page, cursor, or context snapshot.

## Verification

Focused coverage proves:

- only an exact non-direct route receives the group seed;
- explicit seed overrides remain untouched;
- group evidence retains sender and message boundaries while excluding direct
  sessions;
- ordinary group prompts frame the page as optional rough guidance;
- direct prompts receive no group-room guidance; and
- maintenance command scopes keep personal memory and group knowledge writes
  separate.
