# Group Challenge Data Diagnostics

Last verified: 2026-07-18

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
- Gives every missing participant one current evidence-backed reason and the
  smallest useful action, or says the reason is unverified.
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
Foreground, scheduled, notification, and detached read-only turns contact Web
only if the model invokes `read_shared`. Scheduled turns do not receive a
preloaded roster or grant snapshot.

Web answers one model-triggered read with every current member and every
requested scope. Each cell distinguishes `not_granted`, `granted` plus
`missing`, and `available`; a real zero remains available data. Profile labels
come only from the separately granted profile snapshot. Authority, decryption,
parsing, or bound failures return one typed `unavailable` result without shared
records rather than falling back to cached data.

Each returned member has a `participantId` derived from that group's
`HostedGroupMember` row. It is stable only for the lifetime of that exact group
membership and is scoped to the group; it carries no account, device, provider,
or route identity. Duplicate display names and later name changes therefore do
not make challenge joins ambiguous. The trusted Web-to-runtime response retains
the global member id only for existing newsletter authorization composition;
the assistant-engine model boundary removes it and exposes only
`participantId`, the consented display name, bounded `currentTurnHandles`, and
requested projections.

Interactive Linq group turns are actor-scoped. Import derives the blinded
`actorId` from the same trimmed Linq sender value stored for the prompt;
initial batching splits when that actor changes, and both pre-provider and live
admission stop at a foreign group actor. Attribution authority therefore stays
bound to the scanner-selected durable operation contexts instead of being
widened by active steering. A later message from another participant remains
pending for its own model turn.

When the model invokes `read_shared`—and only then—the runtime adds the bounded,
deduplicated route-authorized iMessage handles from that operation scope. The
same Web query selects current member phone and verified-email blind indexes.
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

| Evidence | Public status | Smallest action |
| --- | --- | --- |
| Current challenge-metric data through the reporting cutoff | Include the participant in the ranked standings. | None. Device status cannot override current metric evidence. |
| No current grant for the exact scoring scope | The participant has not shared this challenge metric with the group. | Explain the exact missing share naturally and say the participant can explicitly ask Murph to open the permission offer. |
| Metric scope granted, but no `device-sync-status.v0` grant | Murph cannot verify why the metric is absent because connection status was not shared. | Explain that diagnostic access is missing and say the participant can explicitly ask Murph to open the permission offer. |
| Live diagnostic result with `needs-reconnect` or `disconnected` | Name the literal source label and its current coarse status. | Ask the participant to reconnect that source in their private Murph/app flow. |
| Live diagnostic result with `setting-up` | The visible source is still setting up. | Ask the participant to finish setup in their private Murph/app flow. |
| Live diagnostic result with `needs-attention` | The visible source needs attention; the result does not prove why. | Ask the participant to open Murph and inspect that source privately. Do not translate this into an Apple Health denial. |
| Live diagnostic result with `connected`, but no metric data | The source is connected, but the challenge metric has not reached Murph. | Give a source-appropriate recovery step without claiming a cause. |
| Live diagnostic result with no visible sources | No connected health source is visible in the consented result. | Ask the participant to check or connect a source privately. |
| Diagnostic read unavailable | Murph cannot verify the reason. | Do not guess. Offer a private check and retry only through a later model-triggered read. |

## Apple Health boundary

Apple does not reveal HealthKit read authorization to Murph. Neither a
connection status nor an empty Steps projection proves that a participant
denied, forgot, or has not approved Steps access. Current backend state also
cannot prove that the participant has not opened the app.

When Apple Health has the literal `connected` status in a live diagnostic
result and current Steps are absent from the authorized group snapshot,
Murph may say that this group does not currently have recent Steps for the
participant and that Apple Health is visible as connected. Other Apple Health
statuses follow their status-specific rules. A `connected` status does not
prove private ingestion failed;
projection production may be the missing step. The safe first action is to open
Murph. If Steps still do not arrive, Murph may ask the participant to check
Apple Health Steps access. It must not present either action as the established
cause.

Liking or hearting a group permission offer grants only the disclosed Murph
group-sharing scopes. It cannot grant or change HealthKit authorization.

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
workflow-specific scopes. Challenge kickoff and standings do not create a
hosted group or post an additive permission offer, whether or not the hosted
group already exists. Murph explains the exact missing group setup or share in
ordinary language inside its one normal reply and says the affected participant
can explicitly ask Murph to open the permission flow. The challenge flow never
tells someone to react to an ordinary challenge message.

Only a later interactive turn containing an explicit request to enable the
missing share may enter `group-chat`'s existing `post_join_offer` flow. Web, not
the model, writes that separate offer's causal Like-or-heart sentence, exact
frozen scope disclosure, and first-party customize link. Liking or hearting
adds only that disclosed snapshot; the first-party page remains the customize
path. Ignoring or declining it never causes a retry or nudge.

## Message shape

The update stays one conversational group message. It leads with completeness,
then separates the ranked standings from named participants waiting on data.
For example, the semantic shape is "partial standings: 2 of 5 current," a
ranked section, then a waiting section with one reason/action per person.

Names in the waiting section are operational status, not performance shaming.
Each update may include the participant's current evidence-backed reason and
smallest action because those facts explain how to read the standings. It does
not repeat speculative causes or expose private troubleshooting in the room.

## Deployment compatibility

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
3. Verify complete member/scope matrices, empty-snapshot behavior, stale-writer
   rejection, revoke/regrant clearing, device privacy, and the challenge output
   against the deployed route.

Once Web can write the encrypted snapshot column or serve `read_shared`, the
new Cloudflare consumer is the hard rollback floor. Do not roll Cloudflare back
to a bundle that restores or consumes legacy local projections; disable the Web
producer/read path and forward-fix instead. There is no cleanup wake, local
drain, or foreground reconciliation step in either deployment or rollback.

## Acceptance cases

- Five `in` participants with two current scores produce a "2 of 5" partial
  update, two ranked entries, and three named waiting entries.
- A participant with an explicit zero remains ranked at zero.
- A participant missing the exact metric grant gets a group-share explanation,
  not a device diagnosis.
- A participant missing only diagnostic consent gets an unverified explanation,
  not a guessed Apple Health state.
- An Apple Health `connected` result plus absent Steps recommends
  opening Murph and checking Steps access only as recovery steps.
- A three-day-old connection sync-job timestamp may be named literally but is
  not presented as health-data receipt or a proven cause.
- Challenge kickoff and a scheduled occurrence never call `post_join_offer` or
  emit a second permission message; a missing grant is explained naturally in
  the one normal challenge reply.
- A later interactive permission offer requires an explicit participant request
  and remains owned by the existing group-chat permission flow.
- No output exposes provider keys, account/device identifiers, raw errors,
  health values, or private 1:1 context.
