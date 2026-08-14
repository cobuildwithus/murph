# Group Challenge Data Diagnostics

Last verified: 2026-08-13

Status: Implemented

## Purpose

A group challenge update must stay useful when some participants have no
current score. Murph reports the standings it can prove, names every opted-in
participant whose data is missing, explains only what current authorized
evidence supports, and gives the smallest safe next action.

This contract adds an explicit `device-sync-status.v0` group share. It gives
the room bounded literal connection-status context without exposing private
account or device details. It never establishes why a shared metric is absent.

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
- Gives every missing participant the current evidence-backed status and the
  smallest useful action, while keeping the metric's absence causally
  unverified.
- Keeps individual troubleshooting and private account details in the affected
  participant's private thread.

Murph never presents a partial leaderboard as complete, hides an opted-in
participant because their projection is absent, or turns missing data into a
performance joke.

## Owners and join rules

Four facts remain separate:

1. The challenge knowledge page owns durable challenge participation,
   including `in`, `pending`, `declined`, and `withdrawn`.
2. `apps/web` owns current group membership, current Vault Share grants, and
   the one nullable encrypted projection snapshot on each existing
   `HostedVaultShare` row. An active grant authorizes only its exact canonical
   scope; it does not prove that data is available.
3. `murph.group action="read_shared"` is the only hosted assistant read for
   shared group facts. Web captures the current roster and exact active grants,
   decrypts the bounded snapshots owned by those rows, and returns the complete
   consent/data matrix. No shared copy is landed in a member or group workspace.
4. Web's device-sync owner supplies live connection facts only after an active
   `device-sync-status.v0` grant is captured. Device status is not written into
   the share snapshot column.

The runtime constructs the `read_shared` adapter synchronously. This path adds
no pre-model group, grant, snapshot, device, projection, configuration, or
attribution read; existing accepted-input and route-binding work is unchanged.
Foreground, scheduled, notification, and detached turns contact Web for shared
facts only if the model invokes `read_shared`. Scheduled turns do not receive a
preloaded roster or grant snapshot; the bounded permission action becomes
eligible only after that read returns exact missing-grant evidence.

Web answers one model-triggered read with every current member and every
requested scope. Each cell distinguishes `not_granted`, `granted` plus
`pending`, `granted` plus `missing`, and `available`. `pending` means the exact
grant is active and readable but its first encrypted snapshot has not
materialized; `missing` means a completed snapshot is empty or current access
withholds it. A current grant additionally carries its canonical `grantedAt`,
while a non-grant carries null. The timestamp is bounded authorization metadata,
not proof of why the member granted access. A real zero remains available data.
Profile labels come only from the separately granted profile snapshot.
Authority, decryption, parsing, or bound failures return one
typed `unavailable` result without shared records rather than falling back to
cached data.

That full Web result remains the authority boundary. The assistant-engine model
adapter keys each retained projection by exact scope and maps the grant/data
pair to `not_granted`, `pending`, `missing`, or `available`. Non-workout record
arrays stay intact; `workouts.v0` additionally compacts its repeated day,
activity-kind, time-semantics, and completion-watermark fields. If whole member
rows still exceed the model bound, the adapter returns `status="partial"` and
names each
still-current capacity-omitted membership in `omittedParticipantIds`. Omission
does not imply departure, a score, a diagnostic state, or a permission state.
The assistant keeps those participants unverified and unranked and labels any
standings partial; this model-only compaction never changes stored or
Web-returned truth.

Each returned member has a `participantId` derived from that group's
`HostedGroupMember` row. It is stable only for the lifetime of that exact group
membership and is scoped to the group; it carries no account, device, provider,
or route identity. Duplicate display names and later name changes therefore do
not make challenge joins ambiguous. The trusted Web-to-runtime response retains
the global member id only for existing newsletter authorization composition;
the assistant-engine model boundary removes it and exposes only
`participantId`, the consented display name, bounded `currentTurnHandles`, and
requested projections.

Interactive Linq group turns are room-scoped for batching while attribution
remains message-scoped. Import derives blinded `actorId` and prompt sender
evidence from the authenticated Linq sender, but an exact-successor burst may
batch or steer across actor changes when the authenticated room, route,
account, audience, projection, and reaction boundaries remain stable. Each
admitted message keeps its own opaque ref and sender evidence; active steering
therefore adds no whole-turn participant authority. Participant-specific
effects must resolve the exact accepted message that requested them.

When the model invokes `read_shared`—and only then—the runtime adds the bounded,
deduplicated route-authorized iMessage or SMS handles from that operation
scope. The same Web query selects current member phone and verified-email blind
indexes.
It retains an input handle only when it matches exactly one current membership
and returns it in that row's `currentTurnHandles` beside the
membership-scoped `participantId`; ambiguous, unknown, unverified, and
stale-membership matches are omitted. Scheduled, notification, and detached
reads have empty handle arrays.

This is a current-turn join aid, not a contact roster. The model may associate
only an exact current prompt `Sender:` handle that appears in one returned
member's array. It must not persist or render a handle. The request adds no
state owner, standalone query, decrypted contact roster, or pre-model work.
The legacy `read_current` wire remains unchanged, and the model projection
removes global member ids and legacy roster handles from every group-summary
action.

Health projection delivery replaces the complete bounded encrypted snapshot on
the exact active share row. An encrypted empty record set means the projection
was observed but has no data; `null` means no snapshot has been supplied yet.
Revoke and regrant clear the ciphertext in the same authority transaction, and
regrant rotates the share id, so a stale producer cannot write into a later
grant generation.

Deep sleep and REM sleep remain one user-facing permission each. New access
offers continue to use `deep-sleep-sources-days.v1` and
`rem-sleep-sources-days.v1`; legacy v0 grants and every existing permission,
grant, revoke, and settings control remain valid. Every health scope now
authorizes its public source identity together with the value, including
existing active grants, and each permission description discloses that rule in
one short sentence. The projection shape is uniform: each date can carry one
complete record per available public source, and each record carries a
canonical `{ source, label }` tag plus a `date.source` record key. A canonical
manually entered observation is the explicit `manual` / `Manual` source and is
never attributed to a wearable or aggregator. Murph-derived meal totals use
`murph` / `Murph`. The producer admits at most eight public sources and seven
member-local civil dates, fails closed above the complete 56-record bound, and
never truncates or chooses one source to represent another.
Source-tagged Deep and REM records also carry that provider's bounded
`recordedAt` timestamp, or `null` when unavailable; their `occurredAt` remains
the synthetic UTC midnight used only for civil-date identity.

The same source-preserving rule applies across steps, sleep duration and times,
sleep stages, activity metrics and selectors, workout-day summaries, heart-rate
zones, workouts, and nutrition totals. `workouts.v0` tags each workout item
inside its existing day record and admits up to thirteen workouts independently
for each of eight public sources on a day. Legacy unsourced workout days retain
their original thirteen-item limit, and any source-specific or combined-source
overflow fails the complete projection closed rather than dropping a workout.
The maximum legal 104-item day stays inside the shared 320 KiB delivery and
encrypted-snapshot bound. The other dated health scopes tag the record.
Duplicate normalization may resolve multiple facts within one public source,
but it never compares sources to pick a group-share winner. Single-owner
profile, timezone, and group-email authority records stay unsourced, and
`device-sync-status.v0` retains its existing per-source item list.

When the exact current sender contradicts a visible snapshot, Murph treats that
snapshot as contradicted and unverified rather than repeating it as a current
device value. If the sender supplies an exact metric, value, unit, and civil
date, `record_current_sender_daily_metric` reuses the accepted-message ref to
resolve that participant server-side and durably admits a report to the
participant's personal runtime. The canonical write is a separate `manual`
daily observation; it never edits or deletes a wearable observation. Accepted
means the personal mailbox owns the report. The existing post-checkpoint share
projection then refreshes already-granted scopes, so a later `read_shared` can
return the manual record beside any device record. Missing values or dates are
never inferred, and the action creates no group-owned health-value store.

Persisted unsourced records and the earlier nested source-aware sleep snapshots
remain parseable during convergence. A new join view or access offer still
derives the matching legacy sleep policy request as v1, so existing groups keep
one complete permission without owner reconfiguration. The durable v0 policy
entry remains exact, and saving an existing v0 grant preserves that scope key.
The authenticated sharing controls show v0 and v1 under the same row; turning
that permission off revokes both versions through the existing flow. There is
no separate source-details grant or upgrade control because source identity is
part of every health scope's contract.

A persisted reader that still requests a legacy v0 sleep scope may use records
from the matching v1 grant when no exact v0 grant is active. New source-tagged
records retain every source under the requested v0 scope identity. An earlier
nested v1 snapshot still projects only its historical top-level scalar because
that snapshot did not contain independent record envelopes. When both grants
exist, the exact v0 grant wins, preserving stable authority lookup while both
scope versions share the same source-aware meaning.

Snapshot generation and record times are not proof of a live provider fetch. A
group response may describe the stored source-tagged values and their
timestamps, but it must never call a `read_shared` result a live provider check
or imply that a new provider read occurred. When sources disagree, Murph reports
the values separately. Any later challenge-specific collapsing or scoring rule
must be explicit and downstream; the share contract does not choose a canonical
cross-source value.

The retired `vault-share.delivery` and `vault-share.revoke` mailbox rows are
terminally skipped from their plaintext metadata before payload fetch or
decryption. They do not mutate a workspace or schedule cleanup. Both v2 archive
restore and legacy snapshot materialization exclude `derived/vault-share/**`
and `vault-share/**`; the assistant, CLI, newsletter, and challenge paths never
read those legacy local copies.

The challenge reader starts with knowledge-page participants recorded as `in`,
then joins the current `read_shared` result by exact group-scoped
`participantId`, never by display name or global member id. It never starts
from members that happen to have data. Only an exact canonical scope key is
grant authority; a selector projection kind is not a broad selector grant.

New challenge kickoff performs one post-model-start `read_shared` call with the
exact scoring scope and `device-sync-status.v0` before writing the roster. It
records a row's `participantId` only when an exact current prompt `Sender:`
handle appears in that row's `currentTurnHandles`. This is not prompt preload
and adds no pre-model work. Display-name equality or uniqueness, array
position, projection values, grant state, global member id, and remembered
context are not identity evidence.

For an active legacy challenge page without those keys, a later interactive
turn with new attributable evidence may use that turn's normal `read_shared`
result for one backfill attempt; there is no extra identity read. Scheduled and
detached reads carry no handles and never guess. Otherwise the page records
that identity as unresolved and excludes that entry from scoring and
diagnostics. Only a later exact current-handle match can reopen that one
mapping. Participation state remains unchanged throughout this identity
migration.

## Diagnostic decision order

The current `read_shared` result gates every diagnosis. Murph applies this order
to each `in` participant and stops at the first match:

When a participant explicitly asks whether a shared metric is visible now,
yet, or after a source change, the model that owns the group-shared answer
performs one new `read_shared` call for the exact relevant scope before
answering. This applies both to an ordinary group turn and to the detached
joined-group model serving a private group consultation; the private root only
admits the existing `ask` and never gains the shared reader. A prior tool
result, conversation claim, or connection timestamp is not current shared-data
evidence.

| Evidence | Public status | Smallest action |
| --- | --- | --- |
| Current challenge-metric data eligible under the scope's producer-owned completion marker | Treat every source-tagged value as settled evidence. Reported Deep/REM sleep is available immediately; the member-local future-date guard still excludes future rows, but the current local date alone does not make a reported stage value provisional. If multiple sources exist, name them separately instead of presenting one as the member-wide value. For `workouts.v0`, only dates at or before `calendarClosedThroughDate` are settled. | None. Device status cannot override current metric evidence or select between sources. |
| Current challenge-metric data exists but is not yet eligible under that completion marker | Keep the participant pending and unranked. This is not missing data or a zero. | Do not diagnose, offer permission, or advance completion from the reader's clock. |
| Exact scope granted with a `pending` first projection snapshot | Say the permission is active and the recent shared data is still preparing. Keep the participant pending and unranked. | Invite a retry shortly. Do not diagnose a source, offer permission again, or infer private sync state. |
| No current grant for the exact scoring scope | The participant has not shared this challenge metric with the group. | Include the exact scope in one proactive offer after the current read only when at least one affected participant has neither explicitly declined it nor a prior handled offer action recorded. |
| Metric scope granted, but no `device-sync-status.v0` grant | The current shared read lacks a usable metric; its cause is unverified. Connection status was not shared, but that does not explain the absence. | Include only the diagnostic scope in one proactive offer after the current read when at least one affected participant has neither explicitly declined it nor a prior handled offer action recorded. |
| Live diagnostic result with `needs-reconnect` or `disconnected` | The current shared read lacks a usable metric and its cause is unverified. Separately name the literal source label and coarse status. | The literal status supports asking the participant to reconnect that source privately; do not claim reconnecting will restore the metric. |
| Live diagnostic result with `setting-up` | The current shared read lacks a usable metric and its cause is unverified. Separately say that the visible source is still setting up. | Ask the participant to finish setup privately based on the literal status alone. |
| Live diagnostic result with `needs-attention` | The current shared read lacks a usable metric and its cause is unverified. Separately say that the visible source needs attention. | Ask the participant to inspect that source privately. Do not translate this into an Apple Health denial or an explanation for the absent metric. |
| Live diagnostic result with `connected` | The current shared read lacks a usable metric and its cause is unverified. Separately say only that the source reports `connected`. | Offer a private check as troubleshooting, not as an established cause or guaranteed fix. |
| Live diagnostic result with an empty `sources` array | The current shared read lacks a usable metric and its cause is unverified. Separately say only that this diagnostic result contains no visible sources. | Offer a private source check. Do not infer that no source exists or explain the metric absence. |
| Diagnostic read missing, stale, or unavailable | The current shared read lacks a usable metric; its cause is unverified. | Do not guess. Offer a private check and retry only through a later model-triggered read. |

Any absent shared metric means only that the current consented read lacks a
usable metric; its cause is unverified. It does not prove that the private vault
lacks a workout, that a provider failed to sync, that import failed, or that
snapshot refresh failed. Even a current `device-sync-status.v0` record supports
only its literal source status and timestamps, never a causal claim about the
missing metric. New `activity-days.v0` broad-movement rows carry
`"broad-movement"`; new `workout-days.v0` canonical combined rows carry
`"canonical-workout-day"`. During the producer-first compatibility release,
readers continue accepting legacy unmarked rows until the bounded snapshot
refresh is complete; exact-marker rejection ships only after that drain.
Distinct workouts on one day add in the canonical workout-day rollup; Murph
must never explain or correct a day by replacing one workout's minutes with
another's.

`workouts.v0` completion is conservative and monotonic. Its producer advances
`calendarClosedThroughDate` only after a date has ended in UTC-12, the last
civil timezone to leave it. Event-local or validated vault time zones still
determine each workout's disclosed date and local start time, but neither the
member's current declared timezone nor `time-zone.v0` controls settlement.
The UTC-12 eligibility threshold can occur up to 26 hours after the member's
own midnight. A stale visible snapshot stays pending until the next ordinary
projection refresh advances the watermark; no finite refresh deadline is
promised. Once a dated settled standings snapshot is published on the challenge
page, later imported health data may be recorded as late context but does not
silently rewrite that published ruling.

## Apple Health boundary

Apple does not reveal HealthKit read authorization to Murph. Neither a
connection status nor an empty Steps projection proves that a participant
denied, forgot, or has not approved Steps access. Current backend state also
cannot prove that the participant has not opened the app.

When Apple Health has the literal `connected` status in a live diagnostic
result and current Steps are absent from the authorized group snapshot,
Murph may state only two independent facts: this group does not currently have
recent Steps for the participant, and Apple Health is visible as connected.
Other Apple Health statuses follow their literal status-specific rules.
Opening Murph and checking Apple Health Steps access are private
troubleshooting options only. Murph must not describe either option, the
connection status, or projection production as the cause of the missing Steps.

Accepting a group permission offer through either its native provider gesture
or first-party link grants only the disclosed Murph group-sharing scopes. It
cannot grant or change HealthKit authorization.

## `device-sync-status.v0` privacy contract

The selectable fixed scope is `device-sync-status.v0`, presented to members as
"Health source connection status." It is an explicit group-sharing grant, not
an inference from some other health permission. When a model-triggered
`read_shared` captures that current grant, Web derives one bounded live result
from its existing device state. It does not ask the grantor runtime to project
device data and does not persist device data in the share snapshot column.

The result uses record key `device-sync-status` and this closed data shape:

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

The derivation rules are:

- `observedAt` is the current UTC-day bucket and equals the result record's
  `occurredAt`. It is not a health-data receipt time.
- `sources` contains at most eight unique public source labels, such as Apple
  Health or WHOOP, each at most 80 characters. It does not expose an internal
  provider key.
- When historical and current connections resolve to the same public label,
  Web keeps the complete observation from the latest connection `connectedAt`
  and source `lastSeenAt` generation. It never combines status or timestamps
  from different connection or source generations.
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

Web returns this result only while the member has the explicit scope. The
timestamps are reported with their literal meanings; an old sync-job timestamp
may support saying when that job last completed, but never implies fresh health
data or proves the cause of a missing metric.

## Permission behavior

At challenge kickoff, the exact scoring scope and `device-sync-status.v0` are
workflow-specific scopes. Challenge kickoff does not create a hosted group or
open an additive permission flow. Once a challenge is running, a scheduled
standings turn may call the single model-facing `offer_access` action only after
`read_shared` reports an exact required scope as `not_granted`. Each included
scope must have at least one affected participant for whom the challenge page
records neither an explicit sharing decline for that exact scope nor a prior
handled offer action for that exact participant and scope. A handled action for
one participant never covers another participant.

The operation-local scheduled adapter accepts only scopes supported by that
turn's missing-grant evidence and only one offer attempt. It rejects calls before
the read, unobserved scopes, and every second attempt without calling Web. The
model never chooses between the lower-level `post_join_offer` and
`create_join_link` wire operations. The trusted runtime uses native consent only
when exact provider authority supports it; otherwise it requests the same
first-party join page. Scheduled routes use the link presentation because their
durable route does not preserve a Linq iMessage-versus-SMS subtype.

Web remains the durable authority for the canonical consent sentence, frozen
scope disclosure, recipient-safe delivery, active-offer/all-granted dedupe, and
first-party customize page. Native consent grants only the disclosed snapshot.
A reaction-bound offer that carries health values always says those values
include source names; a sleep-stage offer also names each source's recorded
time. This is the same broadened health-scope meaning used by Web joins and
already-active grants, without a second source-details permission or consent
owner.
A returned link grants nothing until the member accepts the first-party page.
The standings message itself never grants permission.

Only a native access message whose canonical provider creation second falls
inside the current send attempt adds `offeredAt` evidence. This matches Linq's
accepted whole-second timestamp precision. An idempotent replay
retains its original provider time, is still durably bound, and returns
unavailable recency evidence instead of claiming a new adjacent message or
minting a fresh window. When Web finds a covering active native offer instead
of posting another card, assistant-engine exposes the returned first-party URL
as `presentation="link"` so the model never claims another native message
appeared. Standalone and scheduled links use the same presentation. Murph
includes a returned `joinUrl` once in the substantive response, but link
delivery has no canonical presentation receipt and therefore returns
unavailable recency evidence. Neither presentation proves acceptance.

For a finalized challenge, one recent exact-scope grant may count as the social
entry action. The challenge page must record the exact participant and scope
from a same-turn `not_granted` read, the newly posted native tool result's
eligible `offeredAt`, unchanged metric/window/stakes, and a 24-hour deadline. A
later exact-scope `grantedAt` counts only from `offeredAt` through that deadline.
This is an intentional best-effort product rule: it narrows causal ambiguity
but does not claim the grant is challenge-bound legal consent. Links, reused
offers, and missing, older, late, unresolved, or terms-mismatched evidence
require ordinary explicit challenge confirmation.
For each participant whose same read showed `not_granted`, Murph still records
that the offer action was handled so it is not retried. An explicit sharing
decline excludes that participant from the scope decision. The scoring scope is
never offered merely because its grant exists but current data is missing.
Apart from the exact missing diagnostic grant above, stale, disconnected,
reconnect, and other sync/device cases never enter the permission path.

## Message shape

The standings update stays one conversational group message. It leads with
completeness, then separates the ranked standings from named participants
waiting on data. For example, the semantic shape is "partial standings: 2 of 5
current," a ranked section, then a waiting section with one status/action per
person. The scheduled link presentation is included once in that same
substantive message. Murph never authors generic consent copy or tells members
to react to standings.

Names in the waiting section are operational status, not performance shaming.
Each update may include the participant's current evidence-backed status and
smallest action because those facts explain how to read the standings. When a
usable metric is absent, it says the cause is unverified. It does not repeat
speculative causes or expose private troubleshooting in the room.

## Deployment compatibility

The additive recency fields use a smaller consumer-first release on top of the
established cut: deploy the Cloudflare parser and runner first, accepting
missing `offeredAt`, offer-state, and `grantedAt` as ineligible evidence. Then
deploy Web to emit the fields. Older strict consumers cannot accept the new
keys, so Web must not lead this pair. Missing evidence always falls back to
ordinary challenge confirmation; no compatibility flag or second state owner
is required.

This is a consumer-first hard cut:

1. Deploy Cloudflare and the runner bundle with immediate container rollout.
   Prove the new bundle constructs the shared reader with zero I/O before
   `turn/start`, supports `read_shared`, skips legacy delivery/revoke rows before
   payload fetch, excludes both legacy share subtrees during restore, and never
   reads or writes a local shared-data store.
2. After fleet convergence, apply the nullable
   `HostedVaultShare.projectionSnapshotCiphertext` migration and deploy Web's
   encrypted snapshot replacement, direct `read_shared`, and consent-gated live
   device derivation. Before this step, a new runtime calling an old Web fails
   closed with typed shared-data unavailability. The universal new-group core
   omits `device-sync-status.v0`, so ordinary group creation remains compatible
   during this interval. Challenge setup requests that new scope explicitly and
   remains unavailable until Web supports it; there is no retry or widened
   fallback.
   The runtime continues sending the ignored legacy permission-offer template
   field only so old Web accepts the model-triggered scheduled offer during this
   consumer-first window; delete it after Web convergence and rollback-floor
   confirmation.
3. Verify complete member/scope matrices, empty-snapshot behavior, stale-writer
   rejection, revoke/regrant clearing, device privacy, and the challenge output
   against the deployed route.

Once Web can write the encrypted snapshot column or serve `read_shared`, the
new Cloudflare consumer is the hard rollback floor. Do not roll Cloudflare back
to a bundle that restores or consumes legacy local projections; disable the Web
producer/read path and forward-fix instead. There is no cleanup wake, local
drain, or foreground reconciliation step in either deployment or rollback.

The canonical activity-semantics correction uses two small releases instead of
a rollout flag or another state owner:

1. Deploy the compatibility release to Web first. Its parser and encrypted
   snapshot store preserve the optional `broad-movement` and
   `canonical-workout-day` markers while readers still accept unmarked legacy
   rows.
2. Deploy Cloudflare from the same commit with
   `container_rollout=immediate`, prove the runner fingerprint, and confirm one
   ordinary projection carries both markers.
3. Use the existing operator maintenance surface to wake current checkpointed
   grantors in canary and bounded batches. That durable mailbox wake reuses the
   ordinary Temporal, runtime checkpoint, and idle projection paths; it is not
   a new backfill service. Retry failures and verify from aggregate evidence
   that every current activity/workout snapshot was replaced after the
   producer cutover.
4. Only after the legacy population is zero, deploy the separate strict
   consumer release that rejects missing or wrong markers.

Browser replicas rebuild on their normal access/refresh path. Query SQLite,
browser replicas, and group snapshots are derived and rebuildable, so this
correction has no canonical or PostgreSQL migration. Do not add read-triggered
cross-member fanout, polling, a scheduler, or persisted rollout state.

Member-reported daily metrics use a narrower consumer-first cut because Web's
new `health.daily-metric.reported` mailbox kind is ordered in the personal
runtime system lane. Deploy the importing runner with immediate container
rollout and prove its exact bundle fingerprint across eligible targets before
deploying the Web producer. After Web deploys, a synthetic granted steps report
must be accepted once, advance the personal system-lane checkpoint, and appear
beside—not instead of—the device record as `Manual` on a later `read_shared`.
Absence of `unsupported_kind` evidence and of an unconsumed report behind the
system-lane counter is the convergence smoke. The new consumer is the rollback
floor while any report is retained or unconsumed; Web may roll back first to
stop production. Signal-loss recovery stays with the existing bounded mailbox
handoff sweep. Repair means keep the compatible runner, invoke that sweep, and
verify counter progress—never mutate mailbox rows, create an unrelated message,
or add a second queue.

## Acceptance cases

- Five `in` participants with two current scores produce a "2 of 5" partial
  update, two ranked entries, and three named waiting entries.
- A participant with an explicit zero remains ranked at zero.
- A participant missing the exact metric grant gets a group-share explanation,
  not a device diagnosis.
- A participant missing only diagnostic consent gets an unverified-cause
  statement, not a guessed Apple Health state.
- An Apple Health `connected` result plus absent Steps recommends
  opening Murph and checking Steps access only as non-causal troubleshooting
  options.
- A three-day-old connection sync-job timestamp may be named literally but is
  not presented as health-data receipt or a proven cause.
- Challenge kickoff never calls `offer_access` as a side effect.
- A scheduled occurrence may call `offer_access` once after `read_shared`, only
  for exact `not_granted` scopes with at least one affected participant who has
  neither a recorded decline nor a prior handled offer action.
- Missing or stale synced data, a disconnected source, or `needs-reconnect`
  produces ordinary-language recovery guidance and no access offer.
- A scheduled link result exposes only the exact first-party `joinUrl`; it has
  unavailable recency evidence and does not prove acceptance. Murph records
  only that the participant-and-scope offer action was handled so it is not
  retried.
- A covering active native offer returns a freshly presentable link instead of
  a false claim that another native message was posted.
- A provider-idempotent replay outside the current send interval keeps its
  durable message binding but cannot establish challenge-entry recency.
- Same-provider-second chronology is an accepted best-effort ambiguity; no
  challenge-bound or provider-created-versus-replayed claim is made from it.
- A participant whose exact scope was `not_granted` becomes `in` only after a
  newly posted native offer when the later exact `grantedAt` falls inside the
  recorded eligible 24-hour window and the challenge terms did not change.
- Missing rollout evidence, an old or late grant, or changed terms preserves the
  data grant but requires ordinary challenge confirmation.
- No output exposes provider keys, account/device identifiers, raw errors,
  health values, or private 1:1 context.
