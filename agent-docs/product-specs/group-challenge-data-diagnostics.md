# Group Challenge Data Diagnostics

Last verified: 2026-07-16

Status: Implemented

## Purpose

A group challenge update must stay useful when some participants have no
current score. Murph reports the standings it can prove, names every opted-in
participant whose data is missing, explains only what current authorized
evidence supports, and gives the smallest safe next action.

This contract adds an explicit `device-sync-status.v0` group share. It gives
the room enough bounded connection context to distinguish a missing group
grant from a visible source problem without exposing private account or device
details.

## Product outcome

Every scheduled challenge update does all of the following:

- Starts from the challenge page's participants whose participation state is
  `in`. Membership or a sharing grant never creates challenge buy-in.
- Says whether the standings are complete or partial and gives the coverage
  count.
- Ranks only participants with current metric data through the challenge's
  reporting cutoff. A real zero is a score; absent data is not zero.
- Names every `in` participant who is waiting on data in a separate status
  section.
- Gives one evidence-backed reason and the smallest useful action, or says the
  reason is unverified, the first time that gap appears in a group digest.
- Keeps every missing participant named neutrally in later daily digests, but
  moves repeated reasons, actions, and troubleshooting to the affected
  participant's private thread.

Murph never presents a partial leaderboard as complete, hides an opted-in
participant because their projection is absent, or turns missing data into a
performance joke.

## Owners and join rules

Four facts remain separate:

1. The challenge knowledge page owns durable challenge participation,
   including `in`, `pending`, `declined`, and `withdrawn`. It also owns a
   bounded Gap disclosure log with at most one row per participant: `memberId`,
   `firstPublicGapDate`, and a closed evidence category. That log, rather than
   transient model context, gates whether the room receives a reason/action or
   only the neutral waiting entry.
2. `apps/web` owns current group membership and current Vault Share grants.
   Interactive turns read them with `murph.group action="read_current"`;
   scheduled turns receive a narrower trusted runtime snapshot containing only
   current member ids and exact `(projectionScopeKey, shareId)` authority.
3. `vault-cli group shared` reads projections that reached the group vault.
   It is not an authoritative roster, and a grant proves permission rather
   than projection delivery.
4. The member's device-sync owner supplies connection facts. The group sees
   only the separately consented `device-sync-status.v0` projection.

Before every hosted assistant pass or detached read-only Assistant Ask that has
landed group projections, the runtime asks Web for the current active share
authority and reconciles the derived projection store by exact `(memberId,
projectionScopeKey, shareId)`. It removes revoked scopes, former members,
superseded re-grants, and records whose share id does not match the active grant
before the model can run. If the authority read or atomic reconciliation fails,
that model path fails closed and retries without exposing the landed store.
Foreground mailbox imports pause and requeue detached asks until the mutation
and any subsequent assistant pass finish; a resumed ask then revalidates the
new store. The normal mailbox revoke remains cleanup delivery; it is not the
read-time authorization boundary.

The reader starts with challenge participants recorded as `in`, reconciles
them with current Web-owned membership and grants, and left joins metric and
diagnostic projections by exact `memberId`. It never starts from the members
returned by a filtered `vault-cli group shared` result. Only canonical scope
keys are grant authority; a selector projection kind is not a broad selector
grant. If the current roster/grant snapshot is unavailable, Murph does not use
landed records or publish standings for that run because it cannot revalidate
their current authorization.

## Diagnostic decision order

Current grant authority gates use of a landed projection. Within authorized
evidence, Murph applies this order to each `in` participant and stops at the
first match:

| Evidence | Public status | Smallest action |
| --- | --- | --- |
| Current challenge-metric data through the reporting cutoff | Include the participant in the ranked standings. | None. Device status cannot override current metric evidence. |
| No current grant for the exact scoring scope | The participant has not shared this challenge metric with the group. | In an interactive group turn, offer the missing scope once. In a scheduled update, invite the room to ask Murph for a permission card. |
| Metric scope granted, but no `device-sync-status.v0` grant | Murph cannot verify why the metric is absent because connection status was not shared. | Offer the diagnostic scope once in an interactive group turn, or request that interactive card from a scheduled update. |
| Recent diagnostic projection with `needs-reconnect` or `disconnected` | Name the literal source label and its current coarse status. | Ask the participant to reconnect that source in their private Murph/app flow. |
| Recent diagnostic projection with `setting-up` | The visible source is still setting up. | Ask the participant to finish setup in their private Murph/app flow. |
| Recent diagnostic projection with `needs-attention` | The visible source needs attention; the projection does not prove why. | Ask the participant to open Murph and inspect that source privately. Do not translate this into an Apple Health denial. |
| Recent diagnostic projection with `connected`, but no metric data | The source is connected, but the challenge metric has not reached Murph. | Give a source-appropriate recovery step without claiming a cause. |
| Recent diagnostic projection with no visible sources | No connected health source is visible in the shared snapshot. | Ask the participant to check or connect a source privately. |
| Missing or stale diagnostic projection | Murph cannot verify the reason. | Do not guess. Offer a private check or an interactive diagnostic permission card when applicable. |

A diagnostic projection is recent only when its top-level `observedAt` is no
more than two calendar dates behind the challenge's local date. For example,
an observation bucket dated the 14th is usable on the 16th; one dated the 13th
is stale. This is a calendar-date rule, not a rolling 48-hour calculation.

## Apple Health boundary

Apple does not reveal HealthKit read authorization to Murph. Neither a
connection status nor an empty Steps projection proves that a participant
denied, forgot, or has not approved Steps access. Current backend state also
cannot prove that the participant has not opened the app.

When Apple Health has the literal `connected` status in a recent diagnostic
projection and current Steps are absent from the authorized group projection,
Murph may say that this group does not currently have recent Steps for the
participant and that Apple Health is visible as connected. Other Apple Health
statuses follow their status-specific rules. A `connected` status does not
prove private ingestion failed;
Vault Share delivery may be the missing step. The safe first action is to open
Murph. If Steps still do not arrive, Murph may ask the participant to check
Apple Health Steps access. It must not present either action as the established
cause.

Liking or hearting a group permission offer grants only the disclosed Murph
group-sharing scopes. It cannot grant or change HealthKit authorization.

## `device-sync-status.v0` privacy contract

The selectable fixed scope is `device-sync-status.v0`, presented to members as
"Health source connection status." It uses the replacement record key
`device-sync-status` and carries this closed data shape:

```json
{
  "observedAt": "2026-07-16T00:00:00.000Z",
  "sources": [
    {
      "label": "Apple Health",
      "status": "connected",
      "statusObservedAt": "2026-07-16T00:00:00.000Z",
      "connectionSyncJobCompletedAt": "2026-07-16T08:42:00.000Z"
    }
  ]
}
```

The projection rules are:

- `observedAt` is a UTC-day bucket and equals the delivery record's
  `occurredAt`. It bounds unchanged projection revisions; it is not a
  health-data receipt time.
- `sources` contains at most eight unique public source labels, such as Apple
  Health or WHOOP, each at most 80 characters. It does not expose an internal
  provider key.
- `status` is one of `connected`, `needs-attention`, `needs-reconnect`,
  `disconnected`, or `setting-up`.
- `statusObservedAt` says when the owner observed the projected coarse status.
- `connectionSyncJobCompletedAt` is nullable and names exactly what it means:
  a connection-wide sync job completed. One connection can back several
  source labels, so the timestamp may repeat. It is not source-specific and
  does not prove that any health record or challenge metric was received.
- The record excludes account ids and names, device ids and models,
  credentials, tokens, scopes, provider errors, resource payloads, raw health
  data, health values, and private diagnostics.

The group may use the projection only while the member has the explicit scope.
An old record is treated as unverified rather than as forever-current device
truth.

## Permission behavior

When `read_current` returns `status="none"`, the group-chat core-set creation
flow takes precedence; challenge scopes can be added afterward. For an existing
group at challenge kickoff, the route-bound group turn requests the exact
scoring scope and `device-sync-status.v0` together through one additive
`post_join_offer`. Existing members do not rejoin. Web, not the model, writes
the causal Like-or-heart sentence, exact frozen scope disclosure, and
first-party customize link. Liking or hearting adds only that disclosed
snapshot; the first-party page remains the customize path.

An interactive group turn may post one new additive offer when the room asks
for a missing scope. Do not repost it, retry it from a scheduled occurrence, or
nag someone who ignores or declines it. Scheduled challenge turns lack the
current chat-route authority required to post a like-to-consent offer. They
report the missing grant and ask the room to request an interactive permission
card instead of telling someone to like the ordinary standings message.

## Message shape

The update stays one conversational group message. It leads with completeness,
then separates the ranked standings from named participants waiting on data.
For example, the semantic shape is "partial standings: 2 of 5 current," a
ranked section, then a waiting section with one reason/action per person.

Names in the waiting section are operational status, not performance shaming.
The group receives the first factual explanation because it changes how the
standings should be read. Later daily updates still name the participant as
waiting so the leaderboard stays complete, but they do not repeat the reason or
action in the room. Repeated reminders and individual troubleshooting belong in
the participant's private thread. The challenge page records that first public
gap before the message includes its reason/action, using one bounded row per
participant. A failed or ambiguous save makes that digest neutral for the
participant. This fail-closed receipt gate prevents a context reset from
turning a later digest back into a repeated first disclosure.

## Deployment compatibility

This is a Web-first cross-plane change. The new runtime both consumes the
projection and can request its scope through the group tool, so Web must know
the scope before any new prompt can send it:

1. Deploy Web/Vercel first so its strict group-tool parser, join policy, grant
   owner, delivery route, canonical reaction-consent copy, and internal current
   share-authority read recognize `device-sync-status.v0`. Old runners neither
   call that internal read nor advertise or request the new scope, so Web does
   not receive or offer the new scope in this compatibility window.
2. Deploy the hosted-execution parser, projection reader/projector, CLI view,
   pre-model exact-share reconciliation, scheduled roster/grant context, and
   assistant guidance in the Cloudflare runner bundle. Use immediate container
   rollout and runner-fingerprint proof so a warm old consumer is not left
   beside a new projection producer.
3. Verify that the new runner can request, parse, project, treat stale records
   as unverified, and explain `device-sync-status.v0` through the already-ready
   Web control plane.

No coordinated downtime is required with that order. Once the new Cloudflare
runner can request the scope and members can produce its records, Web's strict
scope support and the consumer-capable runner are both rollback floors. To
roll back after that point, first ship a forward-compatible mitigation that
keeps the new scope parser and landed-record consumer but stops new diagnostic
offers and projection production. Revoke every `device-sync-status.v0` grant,
clean the corresponding landed records, and verify both are absent. Only after
that proof may Cloudflare roll back below consumer support; Web rolls back
last. Never put an old Cloudflare consumer beside an existing new-kind record.
Staleness makes an old diagnostic fact unusable for challenge decisions; it
does not delete the landed record.

## Acceptance cases

- Five `in` participants with two current scores produce a "2 of 5" partial
  update, two ranked entries, and three named waiting entries.
- A participant with an explicit zero remains ranked at zero.
- A participant missing the exact metric grant gets a group-share explanation,
  not a device diagnosis.
- A participant missing only diagnostic consent gets an unverified explanation,
  not a guessed Apple Health state.
- A recent Apple Health `connected` projection plus absent Steps recommends
  opening Murph and checking Steps access only as recovery steps.
- A device projection more than two local calendar days old is ignored for
  diagnosis.
- A scheduled occurrence does not call or claim a successful permission offer.
- No output exposes provider keys, account/device identifiers, raw errors,
  health values, or private 1:1 context.
