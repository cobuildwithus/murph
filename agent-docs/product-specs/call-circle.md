# Call Circle

Last verified: 2026-07-06

Status: decisions locked 2026-07-06; not yet implemented. Phase 1 is the next
buildable unit.

## Purpose

Call Circle helps an existing Murph group actually talk on the phone. Friends
want to call each other more, but nobody knows anyone's schedule and
coordination costs kill the intent. Murph acts as the neutral third party:
members privately tell their own Murph when they are usually free, a group
automation matches pairs, Murph double-confirms with each person privately,
and at the agreed time the call happens.

This is a health feature. Social connection is one of the strongest
wellbeing levers, and the product constitution asks for more participation
in life and less inward fixation. Call Circle spends product effort on the
member's relationships instead of their metrics.

## Product Contract

- Any active group member can ask the group's Murph to set up Call Circle in
  the group chat. Setup is per group.
- Availability is private. Each member tells their own Murph preferred days
  and rough time windows in their own 1:1 conversation, or connects a
  calendar there. Only coarse windows ever reach the group container, via a
  dedicated vault-share projection kind. Raw calendars, exact events, phone
  numbers, and private conversation content never enter the group vault.
- A recurring group automation proposes at most one match per member per
  cycle (default cadence: weekly per member, tunable per group). Matching
  rotates pairs so the same two people are not matched twice in a row and no
  member is starved.
- Matches are confirmed privately with each member by their own Murph, in
  their existing 1:1 thread:
  - Morning-of soft confirm, answerable in one word.
  - Short final confirm near the call time.
  - Both must say yes before any call step happens.
- Mystery framing is per-group and honest. Murph may withhold who the match
  is until both confirm, but must never imply a specific person asked for
  the call. Say "I matched you with someone from the group", not "one of
  your buddies wants to talk to you".
- Non-response is a graceful no. One confirm message per step, no chasing.
  A dead match is dropped silently and the pair is eligible again in a later
  cycle. Declining or ignoring never produces guilt copy.
- Every member has an instant off-ramp: "pause calls" or equivalent in their
  own thread pauses their participation per group without leaving the group.
- Consent moment: the first Call Circle DM a member receives from their own
  Murph is the enrollment ask ("Your group asked me to help you all talk
  more. Want in? yes/no"). A yes records a feature consent grant; a no
  records opt-out and stops all Call Circle DMs for that group. Joining a
  group is not by itself consent to Call Circle.

## Call Mechanics By Phase

- Phase 1 (no telephony): when both members confirm, Murph tells each of
  them who they are matched with and that the other is ready now, and one of
  them dials directly. Murph never places a call.
- Phase 2 (Retell connector bridge): at the agreed time Murph places one
  outbound call to member A from a dedicated connector agent whose entire
  script is one line ("This is Murph. Connecting you with a friend from your
  group, one moment."), then transfers the call to member B's verified
  phone. The AI is an operator for one sentence, never a call participant.
  A "Murph Calls" contact card ships with enrollment so the incoming call is
  named. If the transfer fails or B does not answer, the agent tells A it
  will find another time, and both members get a low-key follow-up message.
  Phase 2 does not start until transfer-failure behavior has been prototyped
  and feels acceptable.
- Phase 2 uses the existing phone-call disclosure posture: the connector
  identifies itself as Murph in its single line.

## Non-Goals

- No group-visible scoreboard of who called whom, call counts, or streaks.
  The group chat may celebrate a completed call only if a participant brings
  it up.
- No matching across groups, and no matching people who have not both
  enrolled.
- No conference calls of three or more people in v1/v2.
- No free-form outbound copy authored by the group container for private
  DMs (see security invariants).
- No real-time calendar sync into the group vault.

## Architecture

Roughly 70% of Call Circle rides existing rails. Two primitives are new.

### Reused

- Group containers, provisioning, roster, and the group-chat skill
  (`apps/web/src/lib/hosted-routing/thread-container-service.ts`,
  `apps/web/src/lib/hosted-groups/`,
  `packages/assistant-engine/skills/group-chat/SKILL.md`).
- Canonical automations in the group vault for the matching cadence and
  one-shot morning-of / near-time steps (`packages/core/src/automation.ts`,
  cron execution in `packages/assistant-engine/src/assistant/cron/`). The
  60-minute stale-notification guard applies to scheduled steps.
- VaultShare closed projection registry for availability
  (`packages/hosted-execution/src/vault-share.ts`): new kind
  `call-circle-availability.v0`, current-state, coarse windows plus a
  last-connected recency bucket. Follows the existing add-a-kind path:
  schema parser, member-side projector, join-policy selectability, reader.
- Per-member calendar via Composio connected apps (Google/Outlook) inside
  the member's own container; the member's Murph derives coarse windows
  from it. Calendar data itself never leaves the member container.
- Consent feature scopes with grant/revoke
  (`apps/web/src/lib/legal/consent.ts`; WhatsApp START/STOP is the
  precedent), plus per-member per-group pause state.
- Notification-wake delivery: `assistant.notification.requested` wakes with
  event-id dedupe, queue-only dispatch, server-resolved route, consumed by
  the notification-decision turn (phone-call result path in
  `apps/web/src/lib/phone-calls/result.ts` is the template).
- Phase 2 reuses the Retell stack (`apps/web/src/lib/phone-calls/`):
  rows, signed webhooks, idempotency, and the `transfer_number` dynamic
  variable.

### New Primitive 1: Group-To-Member Private Notification (the linchpin)

A group container must never gain send authority into private threads. It
may only file a request with web, and the member's own Murph decides and
speaks. This primitive is intentionally general; the group health
newsletter's private nudges and future group features use the same rail.

Flow:

1. New `murph.group` action `request_member_notification`, wired like
   `create_join_link`: shared contract in
   `packages/hosted-execution/src/runtime-control.ts`, dynamic tool
   definition, Cloudflare port, web handler in
   `apps/web/src/lib/hosted-groups/group-tool.ts`.
2. Group runtime supplies: target `memberId` (roster id only), a `purpose`
   from a closed enum (`call-circle.enroll`,
   `call-circle.availability-request`, `call-circle.match-confirm`,
   `call-circle.match-outcome`), a purpose-typed zod-validated structured
   payload, and a `dedupeKey`.
3. Web validates: signed Cloudflare callback bound to the group runtime,
   thread-route authority re-read, target is an active member of that exact
   group, feature consent granted (except `call-circle.enroll`, which is the
   consent ask itself), not paused, rate limit per (group, member, purpose).
4. Web persists a `HostedGroupMemberNotification` row and appends a
   notification wake to the target member's own runtime with event id
   `group-member-notify:<groupId>:<dedupeKey>` and an `expiresAt`.
5. The member's Murph renders the ask in its own voice in the existing 1:1
   thread. Skip is allowed (no `require_send`); the member's assistant keeps
   editorial control over quiet hours and timing.
6. The member's structured response returns through a member-side tool
   action keyed by notification id; web validates the notification targets
   that member and is pending, records the response, and appends a response
   wake to the group runtime so the automation continues event-driven.

Security invariants:

- Only member ids cross the group/member boundary. Phones, handles, and
  thread identities resolve web-side only.
- Purpose-typed payloads, never free-form outbound copy. The group runtime
  reads untrusted group-chat text; free-form copy would let any group
  member prompt-inject someone's private DMs.
- Web is the sole authority for membership, consent, pause, rate, and
  dedupe.
- Confirmation state lives in `HostedGroupMemberNotification` rows
  (requested -> delivered/skipped -> responded/expired), never in runtime
  memory.
- The group vault learns only the structured response, never the private
  conversation.

### New Primitive 2: Server-Initiated Connector Call (Phase 2 only)

- A separate minimal Retell "connector" agent (own agent id): one opening
  line, then immediate `transfer_call`. No health content, no conversation.
- Calls are created by the web-side match state machine after both confirms,
  never by a model tool call. Containers never supply phone numbers.
- A dedicated resolver returns member B's verified phone only when the match
  row is in `both_confirmed` state and the current time is inside the
  confirmed window. This extends the existing invariant that the Retell
  layer forwards whatever the server supplies, so the binding guarantee
  must live in the resolver (`apps/web/src/lib/phone-calls/transfer.ts` is
  the pattern).
- Bridge sessions get their own rows keyed by match id; do not overload
  `HostedPhoneCall` semantics that assume a member-initiated agent call.

## Phasing

1. Phase 1: availability projection kind, `call-circle` skill (group
   workflow plus member-side enrollment/availability sections), matching
   automation, the group-to-member notification primitive, consent/pause,
   and the "you are both ready, call now" handoff. No telephony.
2. Phase 2: connector-agent Retell bridge, "Murph Calls" vCard, transfer
   failure handling. Gated on a transfer-failure prototype.
3. Later, only if minutes cost or transfer UX demands it: a silent
   Twilio-class conference bridge.

## Open Questions

- Exact coarseness of availability windows (day-of-week plus broad
  daypart vs. hour ranges) and whether time zones display per member.
- Whether the group chat gets any ambient signal that Call Circle is active
  (recommended: only what members say themselves, plus the setup
  confirmation).
- Retell transfer failure semantics (prototype before Phase 2 commit).
