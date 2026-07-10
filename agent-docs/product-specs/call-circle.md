# Call Circle

Last verified: 2026-07-09

Status: In review on the Call Circle v1 PR. This document describes the
implemented target architecture.

## Purpose

Call Circle helps friends in an existing Murph group talk on the phone. Each
member privately tells their own Murph when they are usually free. Murph then
matches pairs on a weekly cadence, confirms the time in each member's private
thread, and connects a confirmed pair.

This is a health feature because social connection is part of health. It also
fits the product constitution: help people participate in life without adding
scores, streaks, or another feed.

## Ownership

`apps/web` owns the product truth and every decision that can authorize a
message or phone call:

- enrollment, pause state, coarse preferences, and matching cadence;
- match history, windows, confirmations, outcomes, and phone-call binding;
- member access, group membership, notification routing, and call authority.

The hosted assistant only converses and submits a member's own stated answer.
Cloudflare carries that typed request over the existing signed web-control
boundary. Retell is an external side effect behind the existing web-owned phone
call service.

## Enrollment And Consent

Call Circle reuses the generic group join-offer primitive. The group Murph uses
`post_join_offer` with the optional activation
`call-circle.enroll.v0`. The model may author the surrounding group-chat
message, but web fills the join link and adds the complete Call Circle
disclosure.

A supported positive reaction to the exact provider-bound offer is explicit
consent to the disclosed activation. The existing reaction path resolves the
reacting participant, applies normal group-join and share behavior, enrolls the
member in Call Circle, and appends the private setup ask. A reaction to an
unbound offer is retryable during the short send-to-bind gap; thread identity
alone never grants consent.

The generic offer row remains the only offer owner. Call Circle does not add a
second enrollment action, consent table, offer table, or offer-identity
lifecycle. Offer reservation, provider idempotency, provider-message binding,
and reaction lookup all stay in the shared join-offer path.

`HOSTED_CALL_CIRCLE_OFFERS_ENABLED` controls only new offer posting. A stored
activation remains authoritative after posting, so a later gate change cannot
break consent already disclosed in a visible offer.

## Setup And Preferences

After consent, the member's Murph immediately explains the feature, offers a
clear pause off-ramp, and asks for coarse availability. Setup does not wait for
quiet hours, but it still requires active access, current group membership, an
enrolled participant, a deliverable route, and the normal Linq engagement and
line checks.

Preferences contain only:

- coarse recurring day and local-time windows;
- an explicit valid IANA timezone.

Full conversational context stays in the member's private runtime and vault.
Web stores only the coordinator inputs. Call Circle does not read calendars or
persist calendar data.

Members can update preferences, pause, or resume in their own thread. Preference
writes never resume a paused member. A fresh accepted offer may resume a member
only when that offer was posted after the pause.

## Matching

Matching is deterministic server code on a fixed weekly cadence.

- Match rows are the source of truth for history, cooldowns, and partner
  rotation.
- `nextMatchingAt` is only a due cursor. New or updated preferences make the
  participant due; every considered participant advances to the next shared
  weekly boundary.
- A member can receive at most one proposal in a rolling seven-day window,
  including proposals from another group. The match-store claim enforces this
  under stable member-row locks.
- The matcher prefers someone other than each member's most recent partner.
  It permits the repeat only when no other viable pairing remains, so partner
  avoidance cannot starve a small group.
- An exact pair is not proposed again within the seven-day lookback.
- Stated-window intersection, active access, group membership, notification
  reachability, and valid timezones are hard eligibility gates.
- Odd groups leave one member unmatched for that cycle. History ordering gives
  the least recently matched members priority next time.

The group participant cap bounds every proposal scan. Scheduler phases also use
bounded, ordered batches. No growing collection is scanned without a limit.

## Confirmation And Response Authority

Each proposal has a morning confirmation and a final confirmation about twenty
minutes before the call. Both asks are private, answerable with a short yes or
no, and scheduled only when the ask and call start fall within both members'
local daytime window. The final ask resets both response slots, so the bridge
requires two fresh final confirmations.

Each member may decline or make one counter-proposal per match. A counter
updates the absolute window, resets the other side to pending, and returns the
next ask to the scheduler. Non-response expires quietly. Pause, access loss, or
group departure cancels open work before the next user-visible effect.

The assistant request is a strict discriminated union. It contains only the
member's action-specific data. It never contains `groupId`, `matchId`, `side`,
another member's answer, or a phone number.

Web derives the target from durable mailbox context:

- match actions require an exact current Call Circle confirmation anchor plus
  a fresh inbound conversation message;
- preference, pause, and resume actions use an exact setup or confirmation
  anchor when present, or the member's sole active Call Circle group;
- ambiguous, stale, mismatched, or absent match context fails closed.

The normal reply pipeline carries bounded current and prior answered mailbox
ids, so a short follow-up can retain the exact server-owned anchor without
trusting model-generated identifiers.

## Notification Delivery

Call Circle reuses the generic assistant-notification mailbox primitive. Before
persisting a scheduled ask or result, web resolves one concrete destination and
checks it at decision time.

For Linq, delivery requires an established thread, the exact routed source
line, an enabled and usable line, and a recent inbound message under the shared
engagement policy. Participant-only routes are not enough. Scheduled confirms
and results also require the participant's valid timezone and daytime
check. Setup is immediate but keeps the other route, line, engagement, access,
membership, and enrollment checks.

Event ids make every setup, confirm, handoff, and outcome append idempotent.
Signals are best effort because the mailbox item is durable. The generic hosted
retention sweep retries a bounded batch of the oldest unconsumed assistant
notification per member; Call Circle does not own a feature-specific wake
queue or recovery worker.

## Phone Bridge And Outcomes

At the agreed start, one conditional match update claims the bridge only when:

- both final confirmations are fresh;
- the narrow bridge window is still open;
- both participants remain enrolled, active group members, and active hosted
  members;
- no phone call is already attached.

Web resolves member B's verified phone only after the claim, then creates one
ordinary `HostedPhoneCall` for member A with the Call Circle connector agent.
The connector identifies itself, plays the short opening, and transfers to
member B. Phone numbers never enter the assistant request, group runtime, or
group chat.

`HostedCallCircleMatch.phoneCallId` is the unique relation and sole authority
linking the bridge to its phone call. Result handling never infers a match from
the phone-call request key. The generic phone-call provider-start marker
prevents duplicate Retell calls across retries.

Retell webhook registration subscribes to exactly four events:
`call_ended`, `call_analyzed`, `transfer_bridged`, and
`transfer_cancelled`. `HostedPhoneCall.transferOutcome` stores the transfer
fact, with a bridged result dominating a cancelled result under event reorder.
The bounded `resultJson` is claimed with a compare-and-set update. Generic
phone-call results remain immutable. A Call Circle not-bridged result may only
upgrade to completed when later authoritative bridge evidence arrives; a
completed result never downgrades.

After provider start, the phone-call result owner terminalizes the match as
completed or text handoff. Before provider start, the scheduler may re-invoke
the same connector for unclaimed, claimed, attached-but-unattempted, or
attached pre-provider-failed work. The connector recovers or terminalizes
those reservations with conditional writes. Generic bounded stale-start and
stale-analysis sweeps create the same
durable result and notification path when Retell never delivers the expected
webhook.

If the connector is unavailable, a verified phone is missing, or the transfer
does not complete, the match ends as a text handoff. Each member gets a low-key
private note so they can coordinate directly. Notification failure never
reopens or strands the terminal match.

## Data Model

Call Circle adds two product tables:

1. `HostedCallCircleParticipant`: group/member identity, enrollment status,
   coarse preferences, and the `nextMatchingAt` due cursor.
2. `HostedCallCircleMatch`: pair and window, confirmation state, counter caps,
   stage timestamps, terminal outcome, and the unique `phoneCallId` relation.

It also adds the small `transferOutcome` fact to the existing
`HostedPhoneCall`. There is no bridge-session table, availability service,
feature notification table, or scheduler-owned recovery state.

## Security And Privacy Invariants

- Web is the only authority for enrollment, matching, routing, stage timing,
  call claims, phone resolution, and outcomes.
- A model may select the closed Call Circle offer activation and submit the
  authenticated member's own answer. It cannot select another member or a
  match target.
- Exact provider-message binding is required for reaction consent.
- Every transition rechecks the smallest current authority needed before its
  user-visible side effect.
- Phone numbers, private-thread content, availability, and line-health facts
  never enter the group vault or group chat.
- No raw Retell transcript, recording, audio, or webhook body is persisted.

## Non-Goals

- Matching across groups, conference calls, mystery calls, per-group cadence,
  or group-visible call scores and streaks.
- Calendar or free/busy integration.
- A generic notification state machine, Call Circle queue, bridge-session
  table, consent table, or dedicated assistant skill.
- Group-runtime access to private availability or private replies.
- Model-driven matching, target ids, routes, phone numbers, or lifecycle
  transitions.

## Deployment And Rollback

Call Circle spans an additive Postgres migration, web, the Cloudflare runner
bundle, assistant tool registration, and Retell configuration.

1. Apply the additive migrations and deploy web first with
   `HOSTED_CALL_CIRCLE_OFFERS_ENABLED` disabled and
   `HOSTED_CALL_CIRCLE_CRON_ENABLED` unset or not `1`.
2. Deploy the Cloudflare runner and assistant bundle with
   `container_rollout=immediate`. Wait through the configured 300-second active
   grace period and prove every warm runner has converged before proceeding.
3. Confirm the production Linq webhook subscription includes signed
   `message.sent` events and that one reaches the hosted webhook. Outbound
   `message.received` echoes remain a legacy fallback, not readiness proof.
4. Smoke the signed group-tool contract, Call Circle response port, and Retell
   connector and webhook handling.
5. Enable offers. After that path is healthy, enable the cron gate last.

This is a coordinated contract cut: new web requires the mailbox-derived join
offer operation id, while old web rejects that new field. Never deploy the new
runner before web. During the web-first interval, stale runners may briefly
return a generic join-offer unavailable result; use an immediate low-traffic
rollout and monitor it instead of adding a compatibility layer.

For rollback, disable both gates first. Current web and runner support remain
the rollback floor while active participants, pending notifications, matches,
or any visible, non-revoked Call Circle activation offer remain; old web can
accept the generic offer while silently omitting its activation. Current web
also remains the floor while a transfer-aware Retell call is in flight or its
transfer webhook can still arrive. Drain or terminalize those records and
provider events before a coordinated web/runner rollback. The additive schema
may remain throughout the rollback window.
