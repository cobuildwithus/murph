# Device Provider Compatibility Matrix

Last verified: 2026-07-10

## Purpose

This matrix is the planning sheet for new wearable providers.

Use it before adding a provider so you can answer three questions early:
- which metric families will the first version support?
- which existing Murph canonical shapes should those families map onto?
- which descriptor fields need to be settled up front so `device-syncd` and `importers` do not drift?

Not every provider needs every row. The goal is consistent mapping, not forced feature parity.

## Descriptor fields to settle first

Before writing transport or normalization code, make an explicit call on these shared descriptor fields:
- `transportModes`
- `oauth.callbackPath` and `oauth.defaultScopes`
- `webhook.path` and `webhook.deliveryMode`
- `sync.windows`, `sync.jobKinds`, `sync.supportsRemoteDisconnect`, and `sync.supportsTokenRefresh`
- `normalization.metricFamilies`
- `sourcePriorityHints`

If one of these is still unclear, keep the first slice smaller rather than encoding speculative metadata.

## Matrix

The `Sync direction` column records whether a family is pull-capable (the
scheduled reconcile/backfill floor fetches authoritative data) or push-primary
(provider REST is stale or empty, so the inline webhook import is authoritative
and the floor fetch is best-effort). For push-primary cells, never remove the
inline-import carrier; see "Push-primary cells" below and
`agent-docs/operations/device-sync-ingestion-invariants.md`.

| Family | Sync direction | `device-syncd` expectation | `importers` target | Evidence + provenance expectation | Current examples |
| --- | --- | --- | --- | --- | --- |
| Account/profile identity | Pull-capable | Resolve a stable `externalAccountId` during connect. Fetch profile data only when it materially helps later routing, display, or provenance. | Usually provenance plus a bounded `profile` evidence part. Junction profile summaries (default, one snapshot per source) additionally land a `height` observation plus one `note` event for birth date, biological sex, and wheelchair use. | Retain profile payloads only as identity-sanitized evidence parts. Keep stored runtime metadata shallow. | Garmin/Fitbit through Junction, WHOOP, Oura, Strava |
| Daily activity totals | Pull-capable | Backfill or reconcile bounded day windows. Webhooks optional. | `observation` metrics such as `daily-steps`, `distance`, `active-calories`, `total-calories` (including provider `energy-burned` aliases when only kilojoules are available), and `floors-climbed`. | Retain bounded daily-summary evidence parts and record imported sections in provenance. | Garmin/Fitbit through Junction, Oura, Strava |
| Sleep summary/session | Pull-capable; **push-primary for Garmin** (REST stale/empty → inline import authoritative, floor best-effort) | Fetch daily or rolling sleep windows; webhook hints optional. For Garmin, the direct sleep webhook import is the authoritative carrier. | `sleep_session` events plus `observation` metrics such as `sleep-total-minutes`, `time-in-bed-minutes`, `sleep-efficiency`, `sleep-score`, and `sleep-latency-minutes`. | Retain bounded sleep-summary or session evidence parts. Do not invent stages or durations the provider did not send. | Garmin/Fitbit through Junction, Oura, WHOOP |
| Sleep stage timelines | Pull-capable; **push-primary for Garmin `sleep_cycle`** (REST stale/empty → inline import authoritative, floor best-effort) | Use the same windowing as sleep summary. Garmin `sleep_cycle` direct webhook import is the authoritative carrier. | Compact `observation` metrics only when the provider supplies display-grade stage durations; high-frequency stage timelines stay evidence-only. | Retain a bounded evidence part for the stage-bearing payload. Avoid coercing vague summary buckets into staged samples. | Garmin/Fitbit through Junction, Oura |
| Recovery / readiness | Pull-capable; foreground companion enrichment for WHOOP-keyed HealthKit metadata | Reconcile recent daily windows; webhook hints optional. The iOS companion may additionally send the exact `WHOOP Recovery` scalar from one `.inBed` sample per sleep session through the closed metadata route. | `observation` metrics such as `recovery-score`, `readiness-score`, `sleep-score-delta`, `readiness-score-delta`, `stress-level`, and `body-battery`. | Retain a bounded recovery or readiness evidence part plus day-level provenance. Companion records use a client-hashed HealthKit identity and Apple HealthKit provenance with an unverified WHOOP-metadata hint; never retain raw HealthKit identifiers or arbitrary metadata. | WHOOP, Oura, Garmin through Junction, WHOOP-keyed metadata through the iOS companion |
| Continuous vitals / timeseries | Pull-capable | Fetch bounded windows only when a current product fact needs them. Keep reconcile windows small enough to avoid duplicate churn. | Compact daily/session `observation` metrics or display-grade metric facts. Do not normalize provider firehose points into canonical sample rows. | Reduce samples in memory and retain only tiny aggregate evidence parts; full-fidelity timeseries retention requires an explicit product/debug policy and tests. | Garmin/Fitbit through Junction, WHOOP, Oura, Strava |
| User-initiated spot HRV | Companion-only; no provider pull floor by design | Accept one strict, consent-gated compact RMSSD observation derived on-device. Reuse one existing active member-owned Junction connection; the data path must not call Junction or WHOOP HTTP APIs or establish/reactivate a connection. | One `observation` with metric `hrv`, grain `derived_fact`, unit `ms`, immutable capture UUID replay identity, and query alias `hrv-rmssd`. | Preserve the compact derivation envelope as encrypted import evidence and bounded direct-WHOOP/method provenance. Raw pulse intervals, BLE frames, device identity, and Apple Health comparison values never leave the phone. | WHOOP 5/MG private BLE through the internal iOS companion |
| ECG recordings | Pull-capable | Fetch Junction electrocardiogram summaries by default (dozens-to-hundreds of sub-KB recordings per member-year; the endpoint takes date-format windows). | One `measurement` event per recording at `session_start` with `ecg-heart-rate-mean` and `ecg-voltage-sample-count` entries and the classification/inconclusive-cause preserved as qualifiers. | Retain the sanitized recording summary. The `electrocardiogram_voltage` waveform timeseries stays excluded entirely. | Apple Health / Garmin through Junction |
| Workout / activity sessions | Pull-capable; foreground companion enrichment for WHOOP-keyed HealthKit metadata | Fetch list and detail endpoints. Use webhooks only when the provider offers reliable session updates or deletes. The iOS companion may add the exact `WHOOP Strain` scalar from the matching HealthKit workout. | Normal provider workouts become `activity_session` events with session-scoped workout detail under `workout`, including compact `workout.metrics` for values such as calories, heart rate, HRV, strain, speed, elevation, and recording quality. Daily/queryable activity rollups require explicit summary observations or a later projector; normal read paths should not infer them from workout evidence parts. Companion-only Strain becomes an explicit `workout-strain` observation instead: its client-hashed HealthKit identity cannot safely match Junction's provider workout id, so synthesizing another session would create a phantom duplicate. | Retain bounded activity or workout evidence parts. Companion records use a client-hashed HealthKit identity, a closed scalar schema, and Apple HealthKit provenance with an unverified WHOOP-metadata hint. When files or assets exist, retain descriptors rather than synthesizing fake binary content. | Garmin/Fitbit through Junction, WHOOP, Oura, Strava, WHOOP-keyed metadata through the iOS companion |
| Body measurements / composition | Pull-capable | Poll or fetch stable body endpoints only. When the provider returns current body state without a measurement id or timestamp, normalize it as an import-day snapshot instead of inventing history. | `observation` metrics such as `weight`, `bmi`, `body-fat-percentage`, `lean-body-mass`, `waist-circumference`, `systolic-blood-pressure`, `diastolic-blood-pressure`, and `spo2`. | Retain a bounded measurement evidence part and record the effective measurement day in provenance when the provider omits a timestamp. | WHOOP body measurement, Oura daily SpO2, Junction-backed sources when configured |
| Meal / nutrition summaries | Pull-capable | Fetch Junction meal summaries by default for supported connect sources; keep broader nutrition expansions off default polling unless a product need proves them. | Canonical `meal` events with stable Junction-summary-derived `mealId` values, provider IDs as fallback identity only, item names as ingredients, nutrition totals for calories, protein, carbs, fat, fiber, and water, plus bounded documented micronutrients (`nutrition.micros`) with null/zero entries skipped. | Retain sanitized `junction-summary-meal` evidence parts for replay. | Junction meal summaries, including Cronometer-backed sources |
| Cycle / women-health | Pull-capable | Fetch bounded historical windows. Junction menstrual cycle summaries are on the default summary allowlist (~13 cycles per member-year). | Per-cycle `observation` metrics `period-length-days` and `cycle-length-days` (date-derived, falling back to explicit provider length fields) and daily `measurement` events for `menstrual-flow`, `ovulation-test`, `pregnancy-test`, and `menstrual-cycle-deviation` with the provider label preserved as a qualifier. Predicted cycles, indeterminate/unspecified results, and the remaining sub-arrays (cervical mucus, intermenstrual bleeding, contraceptive, sexual activity, progesterone tests) stay evidence-only. Cycle basal-body-temperature sub-arrays also stay evidence-only: the `basal_body_temperature` default timeseries is the canonical seam for that metric, and a second mapping here would land duplicate same-day observations dedupe cannot collapse. | Retain a bounded women-health evidence part. Avoid turning probabilistic upstream state into certainty. | Garmin; Junction menstrual cycle summaries by default |
| Deletions / tombstones | **Push-primary** (no REST backfill for deletes → inline import authoritative, floor best-effort) | Parse provider delete webhooks or API tombstones into explicit provider jobs. The inline webhook/tombstone import is the authoritative carrier; a pull cannot rediscover a record that is already gone. | `observation` events with metric `external-resource-deleted` and a deleted `externalRef` facet. | Retain the deletion payload so future replay can explain why an upstream record disappeared. | Garmin/Fitbit through Junction, WHOOP, Oura, Strava when provider data supports it |
| Activity assets / file descriptors | Pull-capable | Fetch metadata or descriptors only when they add real value. Do not default to large binary fetches. | Evidence parts such as `activity-asset:*` tied back to the matching `activity_session` through `evidenceRoles`. | Keep bounded descriptors or original asset payloads. Do not manufacture `.fit`, `.gpx`, or `.tcx` files from metadata-only endpoints. | Garmin through Junction, Strava |
| Webhook verification / admin | n/a (transport) | Implement `verifyAndParseWebhook()` and optional `webhookAdmin` only when the provider truly requires them. | No direct canonical mapping. Webhooks should still route into scheduled snapshot normalization. | Keep webhook traces small and safe. Store only the data needed for dedupe, replay, and debugging. | WHOOP, Oura challenge, Strava direct, Junction |

### Push-primary cells

Most families are pull-capable: the scheduled reconcile/backfill floor fetches
authoritative provider data on cadence, and webhooks are an early-delivery
optimization. A few cells are push-primary because provider REST is stale or
empty for them, so the inline webhook import is authoritative and the floor
fetch is best-effort (it may legitimately return nothing):

- **Garmin sleep and `sleep_cycle`** — direct sleep/sleep-cycle webhooks deliver
  the data; the Junction REST summary for these is stale or empty.
- **Deletions / tombstones** — a pull cannot rediscover a record that has
  already been deleted upstream, so the delete webhook/tombstone import is the
  only carrier.

For push-primary cells, never remove the inline-import carrier and never let a
"usefulness" gate skip a parseable inline payload. Unconfirmed cells default to
safe: keep both the inline import and the floor. This follows the device-sync
ingestion invariants — push delivers early, pull guarantees eventually, and
neither path gates the other.

Junction historical progress is evaluated per advertised high-signal daily
source/resource pair: activity, sleep, and `sleep_cycle`. Data in another
family (for example activity) is not evidence that Garmin sleep or
`sleep_cycle` landed. Availability describes capability, so empty sparse
resources such as workouts or body measurements are not treated as failed
exports. Garmin delivers requested history
asynchronously and incrementally through daily-data webhooks, so Murph observes
that resource-aware coverage with its existing bounded ladder and accepts late
webhooks after polling ends. An authenticated old-window webhook that produces
canonical events records bounded source/resource evidence for the exact connect
window. The existing deduplicated verification unions that evidence with fresh
REST rows, so complete late coverage clears the source error even when Garmin's
REST sleep response stays empty. If coverage remains incomplete, Murph marks
only the pending source reconnect-required while current ingestion stays active.
To restart the export, the member explicitly confirms the existing
connection-wide disconnect and then reconnects Garmin; this can disconnect
other wearables on the same Junction connection and must be explained before
confirmation. If remote deregistration fails, the local disconnect still stands
and the member is told to remove the connection in the wearable provider account
before reconnecting. Recovery does not depend on an automatic export endpoint,
operator action, or vendor support.
Direct sleep webhooks remain the authoritative carrier.

The direct companion spot-HRV row is deliberately not a provider push-primary
cell: it represents a user-requested local measurement, so no authoritative
provider REST floor exists. A retry replays the same immutable capture UUID and
compact envelope; changed content under that UUID is rejected. A queued retry
after explicit disconnect cannot recreate or reactivate the Junction lane; the
member must run the explicit sign-in/setup flow before later uploads can stage.

### Direct companion capture deployment compatibility

Deploy the Cloudflare hosted runtime first with
`container_rollout=immediate`, require managed-container smoke to report the
new runner-bundle fingerprint, and pass a functional compact-observation import
smoke. Then deploy web acceptance and release iOS last. Do not probe runtime
availability on each request for this low-volume, release-gated lane. For
rollback, remove or roll back web acceptance first, let already-staged companion
jobs drain, and only then remove runtime support.

## Existing canonical shapes to prefer

When adding a provider, prefer these existing shapes before inventing new ones.

### Event kinds

- `observation`
- `sleep_session`
- `activity_session`

### Raw/debug sample streams

- `heart_rate`
- `hrv`
- `respiratory_rate`
- `sleep_stage`
- `steps`
- `temperature`

These streams are reserved for explicit CSV/import/debug sample ledgers. Provider adapters should prefer bounded integration-ingest evidence parts plus compact observation metrics and should not emit high-frequency wearable telemetry as normal canonical samples; core rejects oversized device-provider sample batches. Provider adapters also must not mark observations with `queryVisibility`, `visibility`, or `canonicalFact`; display promotion belongs in deliberate projection code.

Junction timeseries are the concrete model for this boundary. Normal sync may fetch only compact product-needed timeseries, currently blood oxygen and stress level, and must aggregate them before persistence. The vault may keep tiny aggregate evidence such as `junction-timeseries-daily-*`, but it must not persist full `junction-timeseries-*` sample arrays or generic provider snapshots for dropped dense resources. Dense/debug streams such as steps, distance, heart rate, HRV, respiratory rate, and sparse resources such as weight stay out of default sync unless a current product observation needs them. Provider workout/session metrics belong under `activity_session.workout.metrics` unless an explicit projector promotes derived daily facts; the closed companion Strain observation is the documented exception because its redacted identity cannot be joined safely to Junction's workout session. Wearable summaries require compact display-grade facts such as daily activity, sleep, or body observations.

### Observation metrics already in active use

Examples already present in the current providers include:
- activity and movement daily/display facts: `daily-steps`, `distance`, `active-calories`, `total-calories`, `floors-climbed`. Session-only workout values such as strain, recording percentage, elevation, speed, and workout heart rate belong under `activity_session.workout.metrics` unless an explicit projector emits display-grade observations.
- sleep and recovery: `sleep-total-minutes`, `time-in-bed-minutes`, `sleep-efficiency`, `sleep-score`, `recovery-score`, `readiness-score`
- cardiovascular and vitals: `resting-heart-rate`, `average-heart-rate`, `max-heart-rate`, `respiratory-rate`, `spo2`
- body and composition: `weight`, `bmi`, `body-fat-percentage`, `lean-body-mass`, `waist-circumference`, `systolic-blood-pressure`, `diastolic-blood-pressure`
- cycle and reproductive health: `cycle-day`, `period-day`, `cycle-length-days`, `period-length-days`, `pregnancy-week`
- deletion signaling: `external-resource-deleted`

If a provider needs a new metric family, stream, or naming surface, land that change intentionally and update this matrix in the same patch.
