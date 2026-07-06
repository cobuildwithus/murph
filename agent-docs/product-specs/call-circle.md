# Call Circle

Last verified: 2026-07-06

Status: decisions locked 2026-07-06 (revised twice same day: founder review,
then a three-lens Codex stress test against the codebase); not yet
implemented. Ships as one release including the connector bridge.

## Purpose

Call Circle helps an existing Murph group actually talk on the phone. Friends
want to call each other more, but nobody knows anyone's schedule and
coordination costs kill the intent. Murph acts as the neutral third party:
members privately tell their own Murph when they like to talk, web matches
pairs weekly, Murph confirms both sides privately with calendar awareness,
and at the agreed time Murph connects the call.

This is a health feature. Social connection is one of the strongest
wellbeing levers, and the product constitution asks for more participation
in life and less inward fixation.

## Coordination Model (stress-test outcome)

Call Circle is a web-owned feature, like Family plan or billing, that speaks
to members through their own Murphs. Web owns all coordination truth
(enrollment, preferences, matches, confirmations, call authorization) in
ordinary DB rows with conditional-update transitions, and owns all stage
timing with web-side scheduling. Containers only converse: the group's Murph
captures enrollment in the group chat; each member's Murph gathers
preferences and renders confirm asks in its own voice.

This placement follows from three hard constraints found in the codebase:
notification turns cannot carry structured responses out of a container
(no `hostedToolContext`: `packages/assistant-engine/src/assistant/notification-turn.ts`,
`codex-turn/planning.ts`); assistant cron one-shots expire late wakes after
60 minutes, which would silently kill time-sensitive confirms
(`packages/assistant-engine/src/assistant/cron/execution.ts`); and matching
caps must be deterministic server code, not model behavior, because the
group runtime reads untrusted group-chat text. It also satisfies the
persisted-state placement gate: a server-placed phone call must be
authorized by state web can check atomically, which vault or runtime state
cannot provide.

## Product Contract

- Any active group member can ask the group's Murph to set up Call Circle in
  the group chat. Setup is per group.
- Enrollment happens in the group chat. Members who reply "I'm in" (or
  equivalent) are enrolled; attribution resolves the sender to a `memberId`
  through the existing participant-contact lookup (not raw handle string
  comparison). The first private DM is not a consent question; it is a
  transparent start with an instant off-ramp: Murph introduces Call Circle
  for that group and asks what days and times usually work. Chat
  participants without their own Murph cannot enroll; the group's Murph
  points them at the join link.
- Availability preferences are stated conversationally to the member's own
  Murph ("weekday lunches", "Sunday mornings"). The member's Murph submits
  them as coarse structured windows to web, where they are stored on the
  member's participant row. Full-fidelity context stays in the member's
  vault; web holds only the coarse windows the member chose to give the
  coordinator. Members update preferences the same way, any time.
- Web matches pairs weekly (fixed cadence in v1) under deterministic,
  DB-enforced caps: at most one proposal per member per week, no repeat
  pair back to back, rotation so no member is starved. Members are skipped
  for a cycle when the 28-day recipient-reply egress guard would block
  their confirm DM (preflighted web-side, never bypassed).
- Matches are named: "Free at 5 for a call with Mike? yes/no". (A mystery
  mode was considered and deferred; nothing in v1 may imply a specific
  person asked for the call.)
- Confirms are calendar-aware before asking. For a member with a connected
  calendar, web calls a stateless free/busy helper for the proposed window
  (`{free|busy|unknown}`, nothing persisted, no calendar detail read beyond
  the verdict). Busy windows are rescheduled or dropped without disturbing
  the member. Members without a calendar get plain asks.
- Confirm asks are morning-of plus a short final confirm near call time,
  scheduled web-side, clamped to recipient-local daytime hours and gated on
  line health. A late or blocked send is recorded as a match outcome
  (expired/skipped), never silently consumed.
- Rescheduling is capped at one counter-proposal per side per match,
  enforced on the match row. If no fit, the match is dropped quietly and
  the pair is eligible again in a later cycle.
- Non-response is a graceful no: one message per confirm step, no chasing,
  no guilt copy.
- No phone call is ever placed to a member who has not interacted with Call
  Circle in their own thread at least once (automatic: matching requires
  submitted preferences).
- Every member can say "pause" in their own thread; their Murph submits it
  and web stops matching them for that group. Pause, leaving the group, or
  losing access mid-match invalidates pending asks at the next transition:
  every response, confirm, and call-start transition predicate-checks
  active enrollment, membership, and access.

## Call Mechanics

- At the agreed time web places one outbound call to member A via the
  existing Retell stack, using a dedicated connector agent (own agent id)
  whose entire script is one line ("This is Murph. Connecting you with a
  friend from your group, one moment."), then `transfer_call` to member B's
  verified phone. The AI is an operator for one sentence, never a call
  participant, and identifies itself as Murph consistent with the existing
  disclosure posture.
- The connector call reuses `HostedPhoneCall` (member A scoped, request key
  derived from match id and attempt) with a connector brief variant; no new
  call table. Authorization lives one level up: a single conditional update
  claims the match row (`both_confirmed`, not canceled or expired, inside
  the stored absolute window, both members still active) before any call is
  created, and member B's verified phone is resolved server-side only at
  claim time. Containers never supply phone numbers.
- A "Murph Calls" contact card ships with enrollment so the incoming call
  is named.
- Fallback, not a phase: if the bridge fails, B does not answer, or line
  health blocks calling, the connector tells A it will find another time
  and both members get a low-key message with the other's confirmed
  readiness so they can dial directly.
- Transfer-failure behavior (what A hears when B does not pick up) must be
  prototyped on Retell in week one of the build; it is on the critical
  path.

## Non-Goals

- No generic group-to-member notification rail, no purpose enum, no
  notification state table. Web appends ordinary notification wakes
  (family-plan private notifications are the template) and correlates
  responses to match rows.
- No widening of `murph.group` into a cross-thread dispatch surface; it
  gains exactly one narrow action (enrollment capture).
- No silent container turns acting on members' behalf; every ask is
  visible to the member it targets.
- No new VaultShare projection kind and no calendar data in the group
  vault; the group container never holds availability.
- No group-visible scoreboard, call counts, or streaks. The group chat may
  celebrate a completed call only if a participant brings it up.
- No matching across groups, no conference calls, no mystery mode, no
  per-group cadence tuning, and no dedicated assistant skill in v1
  (prompt-local instructions on the wakes carry the behavior until proven
  insufficient).
- No free-form outbound copy authored by the group container for private
  DMs.

## Net-New Surface (complete list)

1. Two tables: `call_circle_participant` (group, member, enrollment
   provenance, pause state, coarse windows, last-matched-at) and
   `call_circle_match` (pair, proposed window as absolute time, per-side
   ask/confirm/counter state, outcome, claimed phone-call id). Match
   transitions are single conditional updates.
2. One group-tool action: enrollment capture from the group chat (sender
   resolved to memberId server-side).
3. One member-side runtime action: submit a structured Call Circle response
   (preferences, confirm yes/no, counter-proposal, pause), validated
   against a pending ask or active participation for that member. This is
   the only new container-to-web write, and it is member-scoped by design.
4. A web cron that runs the deterministic matcher and stage scheduler
   (morning-of and near-time asks, expiry outcomes).
5. A stateless web free/busy helper reading one proposed window from the
   member's connected calendar account.
6. A Retell connector agent config plus a connector brief variant on the
   existing phone-call path.

Everything else is existing rails: group containers and roster, mailbox
notification wakes with event-id dedupe, the notification-decision turn,
participant-contact lookup, LinQ egress guards, Composio accounts, vCard
generation, `HostedPhoneCall` and Retell webhooks.

## Security Invariants

- Only member ids cross the group/member boundary. Phones, routes, and
  calendar verdicts resolve web-side only.
- Web is the sole authority for enrollment, pause, matching caps, stage
  timing, dedupe, and call authorization. Models summarize and converse;
  they never choose unconstrained targets, times, or recipients.
- All deliverability guards (28-day reply guard, quiet hours, line health)
  are enforced web-side as hard gates for these server-initiated sends;
  prompt guidance is not the control.
- The member response action only accepts writes for the authenticated
  member's own pending asks; it cannot touch other members or other groups.
- No failure path may leak member B's phone, a calendar verdict, or
  private-thread content into the group vault, group chat, or logs.
- In-chat enrollment is attested by the group runtime from untrusted chat
  text; the transparency DM and the interact-before-any-call rule are the
  compensating controls.

## Rejected Alternatives (stress-test record, 2026-07-06)

- Group-container-driven orchestration with a generic notification rail and
  silent availability queries: rejected. Silent-query responses have no
  carrier (notification turns cannot post structured data), member 1:1
  replies cannot use group-thread authority, and a hidden query mode would
  be an implicit VaultShare bypass.
- Vault records as match/confirmation state: rejected; a server-placed
  phone call needs atomically checkable server truth, and the persisted-
  state placement gate forbids product truth starting in runtime state.
- A separate bridge-session table: rejected; the match-row conditional
  claim plus `HostedPhoneCall` covers idempotency and lifecycle.
- A new consent table or scope in v1: rejected; the participant row records
  enrollment provenance, and document-backed consent can be added if legal
  posture requires it.

## Open Questions

- Which Composio free/busy tool slug is available under the current session
  policy (verify during build; fall back to plain asks if reads prove
  unreliable).
- Retell transfer-failure semantics (week-one prototype gates the bridge).
- Recipient-local quiet-hour clamps use the signup timezone on
  `HostedMember`; acceptable staleness for v1, revisit if wrong-timezone
  sends appear.
