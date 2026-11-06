# Junction historical sweep efficiency

Research date: 2026-09-11. The follow-up implementation uses daily queued safety
sweeps and event-targeted local days alongside whole-pass no-op telemetry.
Production traffic reduction still requires rollout and measurement.

## Recommendation

Keep bounded historical recovery, but move toward one daily seven-day safety
pass for complete-day oxygen/stress features plus refreshes of days affected by
data events. Keep initial connection backfill and explicit failure recovery
separate. Do not lower the general Junction reconciliation cadence simply to
change this feature lane: it also owns ordinary data and connection recovery.

First measure the new whole-pass import outcome counts. Then prove that event
handling durably schedules the relevant complete-day refresh before reducing
the timer. Preserve the current day eligibility lag, complete collection
validation, timezone semantics, and post-fetch source authorization checks.
No public documentation establishes that a fixed hourly reread is necessary.

## Why the sweeps exist

The original temporal-feature work preserved within-day oxygen/stress patterns
without retaining raw timelines: variation, supported runs, sample-based burden,
and daypart summaries. Its initial plan explicitly excluded new provider calls.
Review remediation established that partial webhook batches cannot prove a
complete local day's features or authoritative absence. Dedicated full-day
fetches became the owner, with a conservative lag after a local day closes.
Later recovery work extended that owner across a bounded historical horizon and
allowed completed jobs to run again for late changes and newly available sources.
See the [original feature plan](../exec-plans/completed/2026-08-11-junction-temporal-features.md),
[authority remediation](../exec-plans/completed/2026-08-11-junction-temporal-ownership-remediation.md),
and [bounded recovery work](../exec-plans/completed/2026-08-12-junction-temporal-round4-recovery.md)
for historical rationale; the current ingestion invariant remains authoritative.

The value is correcting or retracting stale derived features and recovering
late arrivals. Basic readings and ordinary daily observations have separate
ingestion paths. The feature's need for a complete-day collection does not,
by itself, establish the need to refetch seven days every hour.

Owners inspected during the initial investigation (before this change):

- `packages/device-syncd/src/providers/junction.ts`: newest eligible day
  imported during reconciliation; older resource/day jobs queued separately.
- `packages/device-syncd/src/store/jobs.ts`: completed temporal jobs can be
  re-enqueued on subsequent reconciliation.
- `packages/importers/src/device-providers/provider-descriptors.ts`: default
  Junction reconciliation is hourly with a seven-day horizon.
- [Ingestion invariants](../operations/device-sync-ingestion-invariants.md):
  complete-source-day authority is facet-only; partial events cannot replace it.

## What Junction documents

| Contract | Consequence for Murph |
| --- | --- |
| Junction discovers new or changed data through push, polling, or hybrid collection, compares it with ingested data, and sends differences to configured endpoints. Most polled resources run approximately every 15 minutes, with provider exceptions. | Murph can consume change notifications instead of independently rediscovering every change by repeatedly reading history. [Update frequency](https://docs.junction.com/wearables/providers/update-frequency) |
| Timeseries events carry created or updated samples. The latest value for a resource/provider/source-type/timestamp key supersedes earlier values. These batches are not whole-day collections. | Use sample timestamps to identify dirty local days, then fetch complete days before replacing derived features. Do not derive authoritative absence from a partial batch. [Event structure](https://docs.junction.com/webhooks/event-structure), [primary keys](https://docs.junction.com/wearables/providers/data-primary-key) |
| Normal historical-completion events identify a provider, resource, and start/end range. Incremental events arrive as data is discovered; the daily prefix is not a daily schedule. | Bound initial recovery to the notified range. Existing readiness checks can help avoid fetching history while it is still being collected. [Webhook lifecycle](https://docs.junction.com/webhooks/introduction) |
| Garmin's completion event arrives immediately and does not prove history is available. Both old and new Garmin data arrive through incremental events. Reauthentication alone also does not rerun Garmin backfill. | Do not treat completion as readiness or repeated empty reads as progress. Preserve Garmin-specific recovery and process historical arrivals through data events. [Garmin guide](https://docs.junction.com/wearables/guides/garmin) |
| Webhooks have finite retries, exhaustion notifications, and manual replay through the dashboard. | Retain a safety sweep and recovery for delivery gaps; webhook-only correctness is not justified. [Retry policy](https://docs.junction.com/webhooks/retry-policy) |
| Blood oxygen and stress endpoints accept explicit datetime bounds and provider filters and return pagination cursors. Their published parameter lists do not describe an updated-since cursor or conditional ETag mechanism. | Fetch targeted windows; exhaust pagination before claiming completeness. A wider range may reduce HTTP calls but is not a documented change feed. [Blood oxygen](https://docs.junction.com/api-reference/data/timeseries/blood-oxygen), [stress](https://docs.junction.com/api-reference/data/timeseries/stress-level) |
| Historical-pull introspection reports resource status, range, and execution timeline. Resource introspection reports last attempt, oldest/newest data, and sent count. | Use readiness evidence for pending backfill. Do not mistake a newest-data timestamp or last-attempt timestamp for proof that older samples have not changed. [Historical pulls](https://docs.junction.com/api-reference/data/introspection/historical-pulls), [resource introspection](https://docs.junction.com/api-reference/data/introspection/user-resources) |
| Initial provider backfill ranges vary by provider. Ingestion bounds have a seven-day catchment after a configured ingestion end date. | Neither is a requirement for Murph's recurring seven-day hourly sweep. The catchment is an account ingestion-expiry rule. [Historical ranges](https://docs.junction.com/wearables/providers/historical-data-pull-range), [ingestion bounds](https://docs.junction.com/wearables/providers/data-ingestion-bounds) |
| Timestamp and timezone availability differ by provider; some data are floating time. | Preserve exact member-local day mapping and daylight-saving handling. A bare date is not sufficient authority for an absolute full-day window. [Timestamps and time zones](https://docs.junction.com/wearables/providers/timestamps-and-time-zones) |

## Smallest useful changes to evaluate

1. Coalesce event-triggered work by existing resource/day/timezone job identity.
   A burst touching the same day should leave one pending refresh. Events for
   a day not yet eligible must retain a future refresh; events arriving during
   an active fetch must retain a subsequent refresh when needed.
2. Run the bounded seven-day fallback once daily, with targeted events keeping
   changed older days fresh sooner. Retain explicit retry/reconnect obligations.
   Reuse the existing scheduler and queue rather than adding a second service,
   cache, or permanent history-completion ledger.
3. Consider batching adjacent day fetches only if remaining cost warrants it.
   Bound pages, records, memory, and execution time; validate complete coverage
   before per-day replacement and preserve empty-day retractions. Two resource
   requests is only an ideal lower bound before pagination. Batching fetches
   alone does not eliminate per-import authorization or checkpoint requests.

Illustrative scheduled collection work for both resources and seven eligible
days is `2 × 7 × 24 = 336` collections per member-day today versus
`2 × 7 = 14` for a daily fallback: approximately 96% fewer scheduled
collections in this feature lane, before event-triggered refreshes, retries,
pagination, or optional-resource skips. This is arithmetic on default
configuration, not a measured Vercel request reduction.

If daily fallback latency is unacceptable before event targeting is proven,
an intermediate policy can reread the newest eligible day hourly and the six
older days daily: `2 × (24 + 6) = 60`, approximately 82% fewer scheduled
collections. That adds cadence complexity, so the single daily fallback is
the preferred eventual policy.

## Evidence gaps and validation

The reviewed public documents do not establish a universal deletion-event
guarantee, maximum lateness for corrections, or permanent finality for a day.
They also do not establish that an empty response following a transient
provider issue is a deletion. Keep structural validation and bounded repair.
Vendor clarification would improve the eventual fallback horizon; none was
requested from the vendor during this investigation.

Hosted suppression also needs a checkpoint boundary: runner SQLite is excluded
from workspace snapshots. The retained wake must save the scheduling hash with
its exact jobs before Web can publish that hash. A crash before that checkpoint
must replay the original root; successful cold restores must retain same-day
coalescing. The existing completion fence can publish a completed sweep without
introducing another callback or durable owner.

Before changing cadence, test late updates, corrections, complete empty-day
retractions, duplicate and out-of-order events, events during an active fetch,
new connections, delayed Garmin history, missing webhook deliveries, source
disconnects during fetch, partial pagination, timezone changes, and DST days.
Compare complete-day import no-op rates, failed/unknown counts, queue age,
provider calls, and internal callback counts. A persistence-applied count can
include evidence-only writes; it is not a count of useful new health insights.
See the [logging contract](../../docs/hosted-runtime-log-database.md#device-import-no-op-counts).

## Adjacent request reductions

Source inventory reuse already exists across jobs in a pass. The remaining
post-fetch source-authority read protects disconnects and lifecycle changes
before import. Narrowing its snapshot response can reduce payload and compute,
but replacing one response with a smaller response does not reduce HTTP count.
Do not cache authority across provider I/O or blindly forward a source filter:
the current filtered Web snapshot omits disconnected sources, while local
filtering of an unfiltered snapshot can retain the necessary fence evidence.
Reducing redundant jobs removes their admission reads without weakening that
boundary.

Checkpoint coalescing is already implemented on main by commit `0ed7491d35`
([PR #3282](https://github.com/cobuildwithus/murph/pull/3282)). It compares wake
facts, progress generation, and full redacted status inside the existing
checkpoint CAS. It skips only when equivalent future facts have an acknowledged
signal, preserving due work, mailbox progress, legacy, and shutdown recovery.
The exact-version acknowledgment prevents a failed or late signal from
authorizing a skip for newer state. Verify rollout and measured skip frequency
before adding another mechanism; the implementation alone does not prove a
particular traffic reduction.
