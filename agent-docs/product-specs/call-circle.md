# Call Circle

Last verified: 2026-07-10

Status: In review on the Call Circle v1 PR. This document describes the
implemented target architecture.

## Purpose

Call Circle helps friends in an existing Murph group talk on the phone. Each
member privately tells their own Murph when they are usually free, whether they
want matches weekly, every other week, or monthly by default, and whether that
cadence should be weekly, every other week, monthly, or never with a particular
group member. Murph confirms the time in each member's private thread and
connects a confirmed pair.

This is a health feature because social connection is part of health. It also
fits the product constitution: help people participate in life without adding
scores, streaks, or another feed.

## Ownership

`apps/web` owns the product truth and every decision that can authorize a
message or phone call:

- enrollment, pause state, member-owned preferences, and matching cadence;
- match history, windows, confirmations, outcomes, and phone-call binding;
- member access, group membership, notification routing, and call authority.

The hosted assistant only converses and submits a member's own stated answer.
Cloudflare carries that typed request over the existing signed web-control
boundary. Retell is an external side effect behind the existing web-owned phone
call service.

## Enrollment And Consent

Call Circle reuses the generic group join-offer primitive. The group Murph uses
`post_join_offer` with the optional activation
`call-circle.enroll.v0`. The model may select that closed activation, but web
authors the visible offer copy, fills the join link, and includes the complete
Call Circle disclosure. There is no model-authored disclosure validator.

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

Removing the reaction does not revoke enrollment. Enrollment is an accepted,
one-way consent fact; the member can pause in their private thread, which
cancels open work. This avoids making ongoing authorization depend on mutable
provider reaction state.

## Setup And Preferences

After consent, the member's Murph immediately explains the feature, offers a
clear pause off-ramp, and asks for coarse availability. That direct follow-up
does not wait for quiet hours. A scheduler retry does require the member's
stored signup timezone and local daytime; a blocked retry defers its due cursor
by one hour instead of returning to the same midnight boundary each week. Both
paths still require active access, current group membership, an enrolled
participant, a deliverable route, and the normal Linq engagement and line
checks.

Preferences contain only:

- coarse recurring day and local-time windows;
- an explicit valid IANA timezone;
- a weekly, every-other-week, or monthly default cadence;
- bounded private same-group member cadence overrides: weekly, every other
  week, monthly, or never.

Full conversational context stays in the member's private runtime and vault.
Web stores only the coordinator inputs. Call Circle does not read calendars or
persist calendar data.

Members can update preferences, pause, or resume in their own thread. Preference
writes never resume a paused member. A fresh accepted offer may resume a member
only when that offer was posted after the pause.

A member cadence override is stored only in the setter's participant
preferences. It is not returned to the group runtime, copied to another
participant, named in a match record, or included in a notification. `never`
is the exclusion value rather than a second primitive. An override affects
future proposals only; it does not cancel or alter a proposal that already
exists. Setting it back to `default` removes the stored override.

In a private conversation, the member identifies the peer by human name, not
an opaque member id. The private runtime adapter derives the current member's
canonical profile name server-side; the model cannot supply or override that
self identity. Web normalizes each name, scopes it to the group, and uses the
versioned keyed contact-privacy blind-index owner under the
`call-circle-member-name` domain. It stores only the current non-plaintext key
on the participant row and resolves requests across the keyring's readable
versions during rotation. Exactly one other active participant in the same
group must match. A missing, duplicate, or self match fails closed without
returning a roster, candidate names, or member ids to the private runtime.
Once resolved, preferences continue to store the peer's member id rather than
the submitted name.

## Matching

Matching is deterministic server code. The scheduler wakes weekly; eligibility
comes from durable match history and the effective cadence for each candidate
pair.

- Match rows are the source of truth for history, cooldowns, and partner
  rotation.
- `nextMatchingAt` is only a weekly due cursor. New or updated preferences make
  the participant due; every considered participant advances to the next
  Monday boundary. Cadence is not encoded in scheduler state.
- Each side's effective cadence is its override for the candidate or its
  default. That cadence gates how recently the member matched anyone. The
  slower of the two sides also gates exact-pair recurrence. Match history is
  global across Call Circle groups, and proposal creation rechecks it under
  stable member-row locks.
- Any open match blocks another proposal regardless of age; cadence applies
  only after the previous match is terminal.
- Weekly, biweekly, and monthly mean one, two, and four matching weeks. Each
  lookback is shortened by twelve hours so a Monday run is not accepted or
  rejected based on last week's cron jitter.
- One scheduler run captures one `runNow` value for every phase, so phase order
  cannot move a match across the final-ask or expiry boundary. Opaque member ids
  use code-unit order for both canonical pair identity and lock order.
- The matcher first finds the maximum number of disjoint eligible pairs. Among
  maximum-cardinality solutions, its deterministic edge order prefers pairings
  that avoid both members' most recent partner, then least-recent participant
  rank and opaque-id order. Rotation is therefore secondary and can never
  reduce the number of calls; input order does not change the result.
- A pair is never proposed when either member set the other to `never`. The
  pure matcher applies this veto, and proposal creation rechecks it under the
  existing member-row locks so a concurrent preference update cannot create a
  stale proposal. The matcher continues looking for other viable partners.
- Stated-window intersection, active access, group membership, notification
  reachability, and valid timezones are hard eligibility gates. Proposal
  creation locks both member rows, re-reads current preferences and history,
  recomputes the pair's askable window, and requires its exact start and end to
  equal the staged interval before inserting the match.
- Odd groups leave one member unmatched for that cycle. History ordering gives
  the least recently matched members priority next time.

The group participant cap bounds every proposal scan. Scheduler phases also use
bounded, ordered batches. Every enrolled stale seed selected into the bounded
proposal page advances to the next weekly boundary even when malformed or
otherwise ineligible, so a fixed early page cannot monopolize later scheduler
runs. No growing collection is scanned without a limit.

## Confirmation And Response Authority

Each proposal has a morning confirmation and a final confirmation about twenty
minutes before the call. Both asks are private, answerable with a short yes or
no, and scheduled only when the ask and call start fall within both members'
local daytime window. The final ask resets both response slots, so the bridge
requires two fresh final confirmations.

Each member may decline or make one counter-proposal per match, including
revoking their own earlier confirmation while the other side is still pending.
A counter updates the absolute window, resets the other side to pending, and
returns the next ask to the scheduler. Countering closes when the final ask is
sent; that stage accepts only fresh yes or no answers. Non-response expires the
match; a member who had already said yes receives a private terminal note when
the expiry lands inside their daytime window. The narrow expiry-at-quiet-hours
case intentionally ends without another message: v1 preserves quiet hours
instead of introducing delayed-delivery state solely for that terminal note.
The transaction that wins expiry re-reads both responses after the terminal
update and derives recipients from that in-transaction state; a stale scheduler
snapshot cannot notify someone whose answer changed concurrently.
If a final-stage delivery
preflight fails, the match drops and every still-reachable member gets a private
cancellation note. Pause, access loss, or group departure cancels open work
before the next user-visible effect.

The assistant request is a strict discriminated union. It contains only the
member's action-specific data. It never contains `groupId`, `matchId`, `side`,
another member's answer, or a phone number. A cadence update carries only a
human peer name; the server-owned lookup above maps it to an inert preference
member id after same-group, active, unique, and non-self checks. Web never
treats that name or resulting id as effect authority.

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
and ordinary results also require the participant's valid timezone and daytime
check. The terminal handoff note is exempt because the match has already ended
and otherwise disappears silently. Direct setup is immediate;
scheduler-retried setup requires daytime. Both keep the other route, line,
engagement, access, membership, and enrollment checks.

Event ids make every setup, confirm, cancellation, expiry, handoff, and outcome
append idempotent.
Setup and confirmation rows remain revocable until provider entry. Pause, group
departure, and Family access loss update the match/participant authority and
relabel matching unconsumed mailbox rows as
`assistant.notification.superseded` in the same transaction. The hosted
runtime then claims the exact bound-user mailbox row through the signed,
write-fenced `call-circle/notification-claim` web-control route immediately
before provider entry. Web first locks the member and revalidates current
access, group enrollment, and (for confirmations) a still-pending response on
the same match/window. Whichever row update commits first owns the outcome:
claim-first delivery may enter the provider, while every retry revalidates the
same current authority and cancellation-first delivery fails closed.
Cancellation, expiry, handoff, and
outcome event ids are terminal notices and are never superseded by this rule.
Signals are best effort because the mailbox item is durable. The generic hosted
retention sweep retries a bounded batch of unconsumed assistant notifications
at most 24 hours old, choosing the oldest eligible item per member. Older rows
remain subject to normal mailbox retention and are never revived into stale
outreach. Call Circle does not own a feature-specific wake queue or recovery
worker.

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

Immediately before provider startup, the phone-call owner locks both
participants' hosted-member rows in canonical code-unit order. Under those
locks it rechecks the active Call Circle pair, bridge authority, and both
participants' local daytime using the actual provider-attempt timestamp, then
commits the provider-start marker before Retell egress. A boundary crossing
between scheduler selection and provider startup therefore fails closed.

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

Both ordered bridge scheduler loops isolate connector work per match. A phone
resolution, decryption, provider preflight, or connector exception produces a
fixed content-free error and skips only that match; later matches in the
bounded batch still run.

If the connector is unavailable, a verified phone is missing, or the transfer
does not complete, the match ends as a text handoff. Each member gets a low-key
private note so they can coordinate directly. Notification failure never
reopens or strands the terminal match.

A pause that races after the bridge claim but before provider egress may still
allow that already-authorized call attempt to start. Eliminating that
sub-second window would require holding database authority across the external
provider call or adding another lifecycle owner, so v1 treats it as a bounded
residual. Every pre-claim pause still cancels the match, and provider-start
idempotency prevents duplicate calls.

## Data Model

Call Circle adds two product tables:

1. `HostedCallCircleParticipant`: group/member identity, enrollment status,
   private coarse preferences, and the `nextMatchingAt` due cursor. Availability,
   default cadence, and member-id cadence overrides compose inside the existing
   preferences JSON; those preferences add no separate table or column. The
   participant row also has a nullable `memberNameKey`: a derived, versioned,
   keyed, group-scoped non-plaintext lookup key used only to resolve human peer
   names. It is not a preference, display value, or independent product truth,
   and plaintext names are not stored in Call Circle Postgres state.
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
- A member's cadence overrides remain private to that member. Other members and
  the group runtime receive neither the list nor a reason when the matcher
  chooses a different pair.
- Peer-name lookup persists only the versioned keyed name key, searches only
  active same-group participants across readable key versions, and fails closed
  on no match, ambiguity, or self-match without roster disclosure.
- No raw Retell transcript, recording, audio, or webhook body is persisted.

## Non-Goals

- Pairing members across groups, conference calls, mystery calls, administrator-set or
  group-wide cadence, or group-visible call scores and streaks.
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
4. Confirm the Retell connector agent transfers only to
   `{{transfer_number}}`, never reads that value aloud, and has the required
   transfer webhooks enabled.
5. Smoke offer → reaction → private setup → proposal → both confirmation stages
   → Retell bridge → `transfer_bridged` and `transfer_cancelled`. Include one
   signed group-tool call, one `call_circle_respond` call, and the Linq
   `message.sent` offer-bind repair shape. Do not enable the feature if this
   live proof has not run.
6. Confirm the deployed recovery query excludes assistant notifications older
   than 24 hours before the first retention run. Existing older unconsumed rows
   may age out normally; do not manually signal them.
7. Enable offers. After that path is healthy, enable the cron gate last.

This is a coordinated contract cut: new web requires the mailbox-derived join
offer operation id, while old web rejects that new field. Never deploy the new
runner before web. During the web-first interval, current web accepts and
validates the legacy runner's template-only request as an explicit compatibility
marker, then sends a generic join offer with server-authored copy through the
existing link and egress primitives. The compatibility path cannot request a
Call Circle activation. Remove it only after every pre-Call-Circle runner
bundle has drained.

For rollback, disable both gates first. Current web and runner support remain
the rollback floor while active participants, pending notifications, matches,
or any visible, non-revoked Call Circle activation offer remain; old web can
accept the generic offer while silently omitting its activation. Current web
also remains the floor while a transfer-aware Retell call is in flight or its
transfer webhook can still arrive. Drain or terminalize those records and
provider events before a coordinated web/runner rollback. The additive schema
may remain throughout the rollback window.
