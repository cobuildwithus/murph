# Apple Health member diagnostics

Use the existing authenticated operator session to read
`GET /api/ops/device-sync/companion-diagnostics?memberId=<member-id>`.
Resolve the member through the existing member lookup. Do not paste private
responses into issues, PRs, screenshots, or durable investigation notes.
The response is private and `Cache-Control: no-store`.

## Interpreting the evidence

| Field | Meaning |
| --- | --- |
| `lastSourceDataAt` | Latest retained Apple Health source data-arrival timestamp. |
| `lastWebhookHintReceivedAt` | Latest accepted Apple Health webhook hint in the bounded window; hints alone do not prove new data. |
| `lastCanonicalImportCompletedAt` | Latest durable canonical import in the bounded window. Historical backfills can advance this while phone delivery remains stalled. |
| `connections[].pendingRevisions` | Dirty revisions still awaiting processing. Zero proves the current ingestion queue drained, not that the phone uploaded. |
| `observations.entries[].receivedAt` | Server receipt time for a native diagnostic observation. |
| `observation.clientObservedAt` | Phone clock time when the snapshot was captured; client-reported evidence, not an authoritative receipt. |
| `observation.companionSyncAttempts` | SDK-owned latest attempt per resource, with status, attempt times, count, background/historical and power restriction tags. No health values or sample timestamps. |

Start by comparing source arrival with canonical imports. Then inspect the
newest native observation for app/build/OS versions, SDK sign-in and connection
state, paused synchronization, background refresh availability, Low Power Mode,
protected-data availability, and attempt outcomes. Lifecycle triggers distinguish
an unverified session, signed-out session, explicit sign-out, and SDK session
reset. These observations describe an attempted transition, not proof that it
completed. The process-only diagnostic session ID also correlates with the
existing anonymous auth-diagnostic stream.

The endpoint reads the last seven days, at most ten Junction connections,
ten Apple Health sources per connection, 300 receipt signals, and 50 native
observations. Limit flags identify potentially incomplete results. Connection
source `lastDataAt` can predate the receipt window. Native snapshots include
at most 16 resources, prioritizing failures, then recent attempts.
`resourceSamplesTruncated` identifies omitted attempts. SDK history may itself
be cleared during sign-out or reinstall.

`observations.status = unavailable` means the dedicated log database could
not be read. An available empty history means no retained accepted native
observations in this window. Neither means the phone is healthy. Older app
versions, offline phones, sign-out, revoked consent, rate limits, process death,
or failure of the diagnostic upload can all leave gaps. HealthKit read
permission remains unknowable; a permission-request event does not prove access.

## Admission and ownership

The native app posts operational metadata to
`POST /api/device-sync/companion/sync-diagnostics`. The server derives the
member from the verified Privy bearer identity, requires active membership and
current historical launch consent, rejects unknown fields and values, and
accepts at most 16 KiB. It assigns the indexed timestamp itself. Phone times
outside seven days of server time are rejected.

The existing dedicated hosted-runtime-log store owns subject hashing,
deletion fencing, retention, and append. The closed event code is
`device-sync.companion_diagnostic`; the JSON schema marker is
`murph.companion-sync-diagnostic.v1`. The existing per-subject transaction lock
also serializes a cap of twelve observations per minute. `recorded: false`
means an optional observation was not appended. No migration or new data store
is required. Read isolated raw-log queries with the runtime-log read-only
helper, not the primary database helper; never copy rows to simulate joins.

The phone holds at most twelve events in process memory, suppresses repeated
triggers for thirty seconds, and attempts at most twelve requests per minute.
It checks the captured member before and after token acquisition. A different
member drops the old buffer. Each request has a three-second timeout and
refuses redirects. Transient failures wait for the next observation to retry;
there is no autonomous retry timer or disk queue. Telemetry does not grant
session authority, drive Home state, trigger ingestion, or block sync actions.

## Rollout and verification

Deploy this additive backend contract before releasing the native producer.
An older backend rejects optional telemetry without changing health sync.
Existing installs cannot supply these observations until they receive the
native change. This does not reconstruct missing historical phone logs.

Focused tests cover wire admission, auth/consent rejection, log caps/deletion,
operator access, and source-data versus historical-import separation.
The native Foundation checks exercise the real transport's offline behavior,
member switches during suspended authentication, buffer bounds, and wire shape.
Before releasing the native app, additionally run the full iOS simulator suite
and verify foreground/background sync, Low Power Mode, locked-device behavior,
offline recovery, and sign-out on a physical device with the pinned SDK.
