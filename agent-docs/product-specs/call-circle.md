# Call Circle

Last verified: 2026-07-06

Status: decisions locked 2026-07-06 (revised same day after founder review);
not yet implemented. Ships as one release including the connector bridge.

## Purpose

Call Circle helps an existing Murph group actually talk on the phone. Friends
want to call each other more, but nobody knows anyone's schedule and
coordination costs kill the intent. Murph acts as the neutral third party:
members privately tell their own Murph when they like to talk, a group
automation matches pairs weekly, Murph confirms both sides privately with
calendar awareness, and at the agreed time Murph connects the call.

This is a health feature. Social connection is one of the strongest
wellbeing levers, and the product constitution asks for more participation
in life and less inward fixation. Call Circle spends product effort on the
member's relationships instead of their metrics.

## Product Contract

- Any active group member can ask the group's Murph to set up Call Circle in
  the group chat. Setup is per group.
- Enrollment happens in the group chat. Members who reply "I'm in" (or
  equivalent) are enrolled by matching the message's sender handle to the
  group roster. The first private DM is not a consent question; it is a
  transparent start with an instant off-ramp: Murph introduces Call Circle
  for that group, asks for preferences, and says pausing is one word away.
  Chat participants without their own Murph cannot enroll; the group's
  Murph points them at the join link.
- Availability preferences are private and stated conversationally: "weekday
  lunches", "Sunday mornings", time zone aware. They live at full fidelity
  in the member's own vault (time zone from vault metadata). No availability
  projection is shared into the group vault.
- A recurring group automation (default: one proposal per member per week,
  tunable per group) matches pairs. Before proposing, it queries enrolled
  members' stated preferences through the notification rail's silent-query
  mode; responses carry coarse windows in absolute time. Matching rotates
  pairs so the same two people are not matched twice in a row and no member
  is starved.
- Matches are named, not mystery, by default: the morning-of ask is "Free at
  5 for a call with Mike? yes/no". A per-group mystery mode may withhold the
  name until both confirm, but Murph must never imply a specific person
  asked for the call.
- Confirms are calendar-aware before asking. When web files a match-confirm
  request for a member with a connected calendar, it checks free/busy for
  the proposed window server-side (web already owns the Composio account
  binding) and attaches the verdict to the request payload. Busy windows
  bounce back to the matcher without disturbing the member; no calendar
  detail beyond the free/busy verdict for the proposed window is read or
  stored. Members without a connected calendar get plain asks.
- Rescheduling is capped at one counter-proposal per side per match. If no
  fit after that, the match is dropped quietly and the pair is eligible
  again in a later cycle.
- Both members must confirm (morning-of soft confirm plus a short final
  confirm near call time) before any call step happens. Non-response is a
  graceful no: one message per confirm step, no chasing, no guilt copy.
- No phone call is ever placed to a member who has not interacted with Call
  Circle in their own thread at least once (automatic, since matching
  requires stated preferences).
- Every member can say "pause" in their own thread to pause participation
  per group without leaving the group.

## Call Mechanics

- At the agreed time Murph places one outbound call to member A from a
  dedicated Retell connector agent whose entire script is one line ("This is
  Murph. Connecting you with a friend from your group, one moment."), then
  transfers the call to member B's verified phone. The AI is an operator for
  one sentence, never a call participant. It identifies itself as Murph in
  that single line, consistent with the existing phone-call disclosure
  posture.
- A "Murph Calls" contact card ships with enrollment so the incoming call is
  named.
- Fallback, not a phase: if the bridge fails, B does not answer, or line
  health blocks calling, the connector tells A it will find another time and
  both members get a low-key message with the other's confirmed readiness so
  they can dial directly.
- Transfer-failure behavior (what A hears when B does not pick up) must be
  prototyped on Retell in week one of the build; it is on the critical path.

## Non-Goals

- No group-visible scoreboard of who called whom, call counts, or streaks.
  The group chat may celebrate a completed call only if a participant brings
  it up.
- No matching across groups, and no matching people who have not both
  enrolled.
- No conference calls of three or more people.
- No free-form outbound copy authored by the group container for private
  DMs (see security invariants).
- No calendar data in the group vault, and no calendar reads beyond
  free/busy for a concretely proposed window.
- No new VaultShare projection kind; availability flows only through the
  notification rail.

## Architecture

Most of Call Circle rides existing rails: group containers and roster
(`apps/web/src/lib/hosted-groups/`, roster handles landed in PR #398),
canonical automations in the group vault for the weekly cadence
(`packages/core/src/automation.ts`; the 60-minute stale-notification guard
applies to scheduled steps), notification wakes with event-id dedupe and the
notification-decision turn (phone-call result path in
`apps/web/src/lib/phone-calls/result.ts` is the template), consent feature
scopes (`apps/web/src/lib/legal/consent.ts`), Composio calendar accounts
(`apps/web/src/lib/connected-apps/`), vCard generation, and the Retell stack
(`apps/web/src/lib/phone-calls/`).

Two primitives are new.

### New Primitive 1: Group-To-Member Private Notification Rail (the linchpin)

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
   from a closed enum, a purpose-typed zod-validated structured payload, and
   a `dedupeKey`. Call Circle purposes: `call-circle.enroll-start`,
   `call-circle.availability-query`, `call-circle.match-confirm`,
   `call-circle.match-outcome`.
3. Web validates: signed Cloudflare callback bound to the group runtime,
   thread-route authority re-read, target is an active member of that exact
   group, feature enrollment recorded (except `enroll-start`), not paused,
   rate limit per (group, member, purpose).
4. Purposes have a mode. Interactive purposes append a notification wake to
   the member's own runtime (event id
   `group-member-notify:<groupId>:<dedupeKey>`, `expiresAt` set); the
   member's Murph renders the ask in its own voice and may skip (no
   `require_send`). Silent purposes (`availability-query`) run the same wake
   path, but the member's Murph answers from vault data and returns skip; the
   member sees nothing. Notification turns have vault access but no
   connected-app tools, which is sufficient for stated preferences and keeps
   the unattended-turn trust boundary unchanged.
5. For `match-confirm` targeting a member with a connected calendar, web
   enriches the request payload with a free/busy verdict for the proposed
   window before appending the wake (server-side Composio read, scoped to
   that window). A busy verdict is returned to the matcher as a bounce
   without appending any member-facing wake.
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
- Web is the sole authority for membership, enrollment, pause, rate, and
  dedupe.
- Match and confirmation state lives in `HostedGroupMemberNotification` rows
  (requested -> delivered/skipped -> responded/expired) plus match rows,
  never in runtime memory.
- The group vault learns only structured responses, never private
  conversations or calendar contents.
- Unattended (notification/cron) container turns gain no new tool access;
  the only calendar touch is web-side free/busy for a proposed window.
- In-chat enrollment is recorded as attested by the group runtime (sender
  handle matched to roster). The transparency DM and the
  interact-before-any-call rule are the compensating controls; a member who
  never engages privately can never be called.

### New Primitive 2: Server-Initiated Connector Call

- A separate minimal Retell "connector" agent (own agent id): one opening
  line, then immediate `transfer_call`. No health content, no conversation.
- Calls are created by the web-side match state machine after both confirms,
  never by a model tool call. Containers never supply phone numbers.
- A dedicated resolver returns member B's verified phone only when the match
  row is in `both_confirmed` state and the current time is inside the
  confirmed window. The Retell layer forwards whatever the server supplies,
  so the binding guarantee lives in the resolver
  (`apps/web/src/lib/phone-calls/transfer.ts` is the pattern).
- Bridge sessions get their own rows keyed by match id; do not overload
  `HostedPhoneCall` semantics that assume a member-initiated agent call.

## Open Questions

- Which Composio free/busy tool slug is available under the current session
  policy (verify during build; fall back to plain asks if reads prove
  unreliable).
- Retell transfer-failure semantics (week-one prototype gates the bridge).
