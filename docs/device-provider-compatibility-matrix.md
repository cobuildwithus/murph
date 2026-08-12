# Device Provider Compatibility Matrix

Last verified: 2026-07-14

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
| Account/profile identity | Pull-capable | Resolve a stable `externalAccountId` during connect. Fetch profile data only when it materially helps later routing, display, or provenance. | Usually provenance plus a bounded `profile` evidence part. Junction profile summaries (default, one snapshot per source) additionally land a `height` observation plus one `note` event for birth date, biological sex, reported gender, and wheelchair use. Reported gender is a typed demographic field distinct from biological sex; `unknown` and noncanonical future enum values remain evidence-only. A newer versioned profile snapshot replaces changed facts and retracts omitted owned facts instead of leaving stale profile truth live. | Retain profile payloads only as identity-sanitized evidence parts. Keep stored runtime metadata shallow. | Garmin/Fitbit through Junction, WHOOP, Oura, Strava |
| Daily activity totals | Pull-capable | Backfill or reconcile bounded day windows. Webhooks optional. | `observation` metrics such as `daily-steps`, `distance`, `active-calories`, `total-calories` (including provider `energy-burned` aliases when only kilojoules are available), `floors-climbed`, activity average/walking-average/minimum heart rate, and low/medium/high activity minutes. Junction's three intensity durations are already minute-valued; each is admitted only within `0..1440`, and their sum supplies `activity-minutes` only when it is at most 1440. The wearable activity projector owns these heart-rate and intensity fields separately from sleep, including metric-latest and trend reads. | Retain bounded daily-summary evidence parts and record imported sections in provenance. | Garmin/Fitbit through Junction, Oura, Strava |
| Sleep summary/session | Pull-capable; **push-primary for Garmin** (REST stale/empty → inline import authoritative, floor best-effort) | Fetch daily or rolling sleep windows; webhook hints optional. For Garmin, the direct sleep webhook import is the authoritative carrier. | `sleep_session` events plus `observation` metrics such as `sleep-total-minutes`, `time-in-bed-minutes`, `sleep-efficiency`, `sleep-score`, and `sleep-latency-minutes`. | Retain bounded sleep-summary or session evidence parts. Do not invent stages or durations the provider did not send. | Garmin/Fitbit through Junction, Oura, WHOOP |
| Sleep stage timelines | Pull-capable; **push-primary for Garmin `sleep_cycle`** (REST stale/empty → inline import authoritative, floor best-effort) | Use the same windowing as sleep summary. Garmin `sleep_cycle` direct webhook import is the authoritative carrier. | Compact `observation` metrics only when the provider supplies display-grade stage durations; high-frequency stage timelines stay evidence-only. | Retain a bounded evidence part for the stage-bearing payload. Avoid coercing vague summary buckets into staged samples. | Garmin/Fitbit through Junction, Oura |
| Recovery / readiness | Pull-capable; foreground companion enrichment for WHOOP-keyed HealthKit metadata | Reconcile recent daily windows; webhook hints optional. The iOS companion may additionally send the exact `WHOOP Recovery` scalar from one `.inBed` sample per sleep session through the closed metadata route. | `observation` metrics such as `recovery-score`, `readiness-score`, `sleep-score-delta`, `readiness-score-delta`, `stress-level`, and `body-battery`. | Retain a bounded recovery or readiness evidence part plus day-level provenance. Companion records use a client-hashed HealthKit identity and Apple HealthKit provenance with an unverified WHOOP-metadata hint; never retain raw HealthKit identifiers or arbitrary metadata. | WHOOP, Oura, Garmin through Junction, WHOOP-keyed metadata through the iOS companion |
| Continuous vitals / timeseries | Pull-capable | Fetch bounded windows only when a current product fact needs them. Keep reconcile windows small enough to avoid duplicate churn. | Compact daily/session `observation` metrics or display-grade metric facts. Apple HealthKit HRV maps to `hrv-sdnn`; generic wearable HRV retains RMSSD semantics. Do not normalize provider firehose points into canonical sample rows. | Reduce samples in memory and retain only tiny aggregate evidence parts; full-fidelity timeseries retention requires an explicit product/debug policy and tests. | Garmin/Fitbit through Junction, WHOOP, Oura, Strava |
| Automatic scheduled overnight PRV | Companion-only; no provider pull floor or backend capture scheduler by design | After one local Connect WHOOP enrollment, iOS continuously subscribes to the WHOOP 5/MG stream and automatically reduces the fixed `00:00–08:00` local civil-time occurrence into non-overlapping five-minute RMSSD windows using `prv-rmssd-5m-mean-scheduled-0000-0800-local-v1`. The schedule freezes that night's timezone rules; a fully traversed occurrence is bounded to 84...108 windows, typically 84/96/108 with intermediate counts such as 90/102 for half-hour shifts. Submit one nightly mean only after at least 48 accepted windows and at least 50% acceptance. A disconnect or process gap hard-breaks interval/window adjacency. Local enrollment sends no hosted lifecycle intent. Separately, known same-member passive SDK repair uses `resume`, while fresh/unproven install omits intent so server state resumes exactly one established lane, establishes only when zero provider rows exist, and rejects terminal/ambiguous state. Only a future visible hosted-health/Junction Reconnect action may send `connect`. | One immutable summary-grain `observation` per vault, `whoop` source, and `nightDate`, with metric `whoop-ble-overnight-prv-rmssd`, unit `ms`, synthetic 12:00Z `occurredAt`, no event `timeZone`, and direct-BLE/method provenance. It has no generic `hrv` or biomarker alias and stays distinct from Apple HealthKit `hrv-sdnn` plus the existing selected daily provider `hrv-rmssd` series. | Upload only `schema`, `methodVersion`, `nightDate`, `rmssdMs`, `completedWindowCount`, and `acceptedWindowCount`. Local persistence is limited to one OS-protected versioned scalar night checkpoint, at most three already-derived strict envelopes, and the exact app-scoped CoreBluetooth peripheral UUID needed to restore the enrolled band. That UUID never uploads or enters logs; raw intervals/packets, partial-window state, packet timestamps, every other band identifier, and per-window values remain memory-only. Exact capture timestamps/duration, timezone details, and coverage never upload or enter logs. One local watchdog reminder covers stopped callbacks; force-quit requires reopening Murph. Beta wellness PRV only until signed-iPhone WHOOP 5/MG and paired-ECG validation pass. | WHOOP 5/MG private BLE through the internal iOS companion |
| ECG recordings | Pull-capable | Fetch Junction electrocardiogram summaries by default (dozens-to-hundreds of sub-KB recordings per member-year; the endpoint takes date-format windows). | One `measurement` event per recording at `session_start` with `ecg-heart-rate-mean` and `ecg-voltage-sample-count` entries and the classification/inconclusive-cause preserved as qualifiers. | Retain the sanitized recording summary. The `electrocardiogram_voltage` waveform timeseries stays excluded entirely. | Apple Health / Garmin through Junction |
| Workout / activity sessions | Pull-capable; Junction workout streams are shallow-webhook/exact-fetch; foreground companion enrichment for WHOOP-keyed HealthKit metadata | Fetch list and detail endpoints. A Junction `workout_stream` webhook must carry an exact `workout_id`; schedule one durable execution, fetch only `/v2/timeseries/workouts/{workout_id}/stream` with the provider client's bounded three-request attempt budget, and reduce in memory. Before import, revalidate the fetched stream's source identity against local and remote connection authority without projecting the full source catalog. Sparse `workout_duration` uses ordinary bounded timeseries windows; the high-frequency `workout_distance` and `workout_swimming_stroke` row feeds are excluded. The iOS companion may add the exact `WHOOP Strain` scalar from the matching HealthKit workout. | Normal provider workouts become `activity_session` events with session-scoped workout detail under `workout`. Exact stream data adds sibling measurement facts under the same stable workout resource identity: capped overall HR/power/cadence/speed features and at most 64 fixed-distance splits. Newer exact corrections authoritatively replace those feature and split facets, withdrawing omitted stale splits; same-version replay is idempotent. `workout_duration` remains independent unless Junction explicitly supplies a workout ID, and temporal overlap is never treated as linkage. Companion-only Strain remains a separate `workout-strain` observation because its redacted identity cannot safely match Junction's provider workout id. | Retain only versioned compact feature/fact evidence. Dedicated streams are capped at 8 MiB and 50,000 input points before reduction; raw arrays, downsampled arrays, route coordinates, inferred zones, and provider-snapshot fallback are forbidden. Split output uses at most 64 fixed-distance facts. | Garmin/Fitbit through Junction, Apple Health workout timeseries through Junction, WHOOP, Oura, Strava, WHOOP-keyed metadata through the iOS companion |
| Body measurements / composition | Pull-capable | Poll or fetch stable body endpoints only. When the provider returns current body state without a measurement id or timestamp, normalize it as an import-day snapshot instead of inventing history. | `observation` metrics such as `weight`, `bmi`, `body-fat-percentage`, `lean-body-mass`, `waist-circumference`, `systolic-blood-pressure`, `diastolic-blood-pressure`, and `spo2`. | Retain a bounded measurement evidence part and record the effective measurement day in provenance when the provider omits a timestamp. | WHOOP body measurement, Oura daily SpO2, Junction-backed sources when configured |
| Meal / nutrition summaries | Pull-capable | Fetch Junction meal summaries by default for supported connect sources; keep broader nutrition expansions off default polling unless a product need proves them. | Canonical `meal` events with stable Junction-summary-derived `mealId` values, provider IDs as fallback identity only, item names as ingredients, nutrition totals for calories, protein, carbs, fat, fiber, and water, plus bounded documented micronutrients (`nutrition.micros`) with null/zero entries skipped. | Retain sanitized `junction-summary-meal` evidence parts for replay. | Junction meal summaries, including Cronometer-backed sources |
| Cycle / women-health | Pull-capable | Fetch bounded historical windows. Junction menstrual cycle summaries are on the default summary allowlist (~13 cycles per member-year). | Per-cycle `observation` metrics `period-length-days` and `cycle-length-days`, derived only from the current Junction Summary contract's documented, calendar-valid [`period_start`, `period_end`, and `cycle_end`](https://docs.junction.com/api-reference/data/menstrual-cycle/get-summary) endpoints, plus calendar-valid dated `measurement` events for menstrual flow, ovulation/pregnancy/progesterone tests, cervical mucus, intermenstrual bleeding, specified contraceptive use, sexual activity, and detected deviations. The current [Junction wearable API changelog](https://docs.junction.com/changelog/wearables/api) likewise lists those dates and `is_predicted`, not legacy `cycle_start` or scalar length fields. Only resource-specific documented enum values become canonical; invalid dates, undocumented legacy scalar lengths, predicted cycles, unknown, indeterminate, unspecified, future, and context-invalid values remain evidence-only. Newer versioned actual-cycle snapshots revise stable current facts and retract omitted owned facts. Cycle basal-body-temperature facts also stay evidence-only: the `basal_body_temperature` default timeseries is the canonical seam for that metric, and a second mapping here would land duplicate same-day observations dedupe cannot collapse. | Retain one deterministic flattened women-health evidence part, capped at the newest 64 cycles and newest 512 dated facts per response after actual/canonical priority. Opaque source-instance identity keeps distinct same-provider sources separate but never appears in retained evidence. Omit provider-shaped arrays and raw source app/device IDs. Avoid turning probabilistic upstream state into certainty. | Garmin; Junction menstrual cycle summaries by default |
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

A push-primary source has no pull guarantee, so its carrier can die without any
observable error: the aggregator keeps reporting the connection `connected` with
every resource `available`, and the floor fetch returns zero rows exactly as it
would for a member who simply has no new data. Source rows therefore carry
`last_data_at`, stamped at webhook ingress from the source the payload names.
This is distinct from `last_seen_at`, which the reconcile projection refreshes
whenever the aggregator still lists the source and which consequently cannot
show a stall. Only an inbound payload moves `last_data_at`; the projection must
leave it alone.

`packages/device-syncd/src/source-staleness.ts` owns which sources are
push-primary and how long each may stay silent, and the hosted device-sync
maintenance pass reports breaches as `device-sync.source_stalled` on every pass.
Suppressing repeats is the alerting layer's job: the pass runs from both an
explicit device-sync wake and scheduled idle maintenance, so nothing at that
seam knows how much time one evaluation represents, and a synthetic interval
would either double-report or skip the first crossing. Evaluation is observation
only: it never changes source status, gates ingestion, or triggers
recovery, and a failure to evaluate or report must not fail the sync pass. A
source that has never delivered is measured from `first_seen_at`, so a connect
that emits its opening burst and then goes quiet is caught by the same rule.

Recovering a dead push carrier cannot be done by pulling, because there is
nothing to pull and a data refresh cannot make the provider push again. The only
lever short of member re-authorization is asking the aggregator to re-run its
historical pull for that one source (`bulkTriggerHistoricalPull`). Junction ships
that behind Link Migration, which is disabled per team by default, so a gated
403/404 is reported as `endpointUnavailable` — an "ask support to enable it"
answer, not a transport failure to retry.

Recovery is automatic, behind an explicit activation switch
(`JUNCTION_PUSH_SOURCE_RECOVERY_ENABLED`, default off). The trigger endpoint is
enabled per team by the vendor, so shipping this code and switching it on are
deliberately separate steps: the rollout does not wait on a support request, and
the capability can be switched off again without a deploy if the endpoint
misbehaves. Once switched on: The scheduled pass that detects the stall also derives a
bounded recovery attempt from connection metadata, the same way the
historical-backfill ladder works, so a member never has to notice or act. The
ladder is episode-scoped on `silentSinceAt`: attempts fire at detection, +6h,
+24h, and +48h, then stop; a gated endpoint records `unavailable` and stops
immediately because nothing local can enable it; and a source that recovers and
later stalls again starts a fresh ladder with no reset step. At most one source
per connection is triggered per pass. `packages/device-syncd/src/junction-push-source-recovery.ts`
owns that policy. The hosted ops recovery route remains for operator-driven
one-off triggers and for exercising `refresh`.

Junction historical progress is evaluated per advertised high-signal daily
source/resource pair: activity, sleep, and `sleep_cycle`. Data in another
family (for example activity) is not evidence that Garmin sleep or
`sleep_cycle` landed. Availability describes capability, so empty sparse
resources such as workouts or body measurements are not treated as failed
exports. Recognized SDK sources such as Apple Health participate independently
of the Link-only `JUNCTION_PROVIDER_FILTER`.

The importer owns summary semantics and emits bounded canonical
source/resource normalization evidence; historical coverage must consume that
evidence rather than maintain a second raw-payload metric parser. Junction's
historical-pull status is authoritative when available: `success` completes an
obligation even with zero rows, provider-specific history ranges are accepted
as reported, and `not_pulled` creates no obligation. Scheduled, in-progress,
retrying, unknown, malformed, or unavailable status stays pending on the
existing daily retry cadence. Canonical normalization evidence and
authenticated old-window push evidence are the bounded fallback when
introspection is unavailable. Direct Garmin sleep webhooks remain the
authoritative carrier.

Connection metadata owns aggregate retry status, attempts, and cadence across
pending sources; a provider source row owns provider-specific recovery state.
Once the shared observation ladder is saturated, an explicit Junction
`failure` for every still-pending Garmin obligation can mark the Garmin source
reconnect-required while aggregate metadata remains `retrying` for another
provider. Successful Garmin coverage clears that source marker independently.
Current ingestion stays active. The member must confirm the existing
connection-wide disconnect before restarting the Garmin export, because the
reset can disconnect other wearables on the same Junction connection. If
provider-side deregistration fails, the local disconnect still stands and the
member must remove the connection in the Garmin account before reconnecting.

The direct companion overnight-PRV row is deliberately not a provider
push-primary cell: the continuously subscribed phone is the scheduled summary
producer, so no authoritative provider REST floor or backend capture scheduler
exists. The first strict envelope owns its
active connection plus `nightDate` for the 30-day, 64-receipt window. An exact
retry is a no-op and changed content conflicts. A queued retry after explicit
disconnect cannot recreate or reactivate the Junction lane. The local Connect
WHOOP action enrolls only the band and sends no hosted lifecycle intent. A
separate known same-member passive SDK repair uses `resume`; a fresh or
unproven install omits intent so
server state resumes exactly one established lane, establishes only when zero
provider rows exist, and rejects terminal or ambiguous state. Only a future
visible hosted-health/Junction Reconnect action may send `connect`; omission
cannot undo disconnect.

### Direct companion capture deployment compatibility

Deploy the Cloudflare hosted runtime first with
`container_rollout=immediate`, require managed-container smoke to report the
new runner-bundle fingerprint, and pass a functional compact-observation import
smoke. Then deploy web acceptance and release iOS last. Before distribution,
require a signed physical-iPhone WHOOP 5/MG continuous-subscription and
overnight capture-to-query test covering background, reconnect,
force-quit-watchdog, DST, and timezone changes; network/log proof that forbidden
raw data is absent; and paired-ECG validation. Do not probe runtime availability
on each request. Once scheduled-method iOS clients ship, keep web and runtime
support until those clients and already-staged companion jobs drain. Roll back
in reverse order.

## Existing canonical shapes to prefer

### Junction resource policy and history

`@murphai/contracts` owns a checked-in inventory of the 57 resources in the
current Junction wearable audit scope and one static policy for each. Importer
allowlists, runtime configuration, webhook recognition, and extended-history
selection derive from that table. Updating the inventory without making an
explicit admission, frequency, retention, and history decision fails the
contract test; this is a build-time contract, not a runtime registry or
persisted state owner.

`workout_stream` is classified as a dedicated fetch surface and is not admitted
through generic summary or timeseries fetching. `electrocardiogram_voltage` is
explicitly excluded from normal sync: full ECG waveforms must not enter the
vault, and any future support requires bounded derived features linked to the
existing ECG recording summary.

The ordinary timeseries backfill remains 14 days. Currently supported sparse
VO2 max, temperature, basal temperature, caffeine, one-minute heart-rate
recovery, sleep-breathing-disturbance, and AFib-burden facts receive 180 days
through the existing per-source resource-job owner. Each continuation fetches
at most one 30-day provider window and still normalizes into the existing daily
compact facts; it does not retain provider sample arrays or emit canonical
samples. Scheduling offers at most eight extended-history resource/source jobs
per reconcile pass and rotates deterministic pages across the bounded Junction
connect-source catalog. Blood pressure and note keep their existing daily
history chunks and coverage semantics.

The checked-in inventory is guarded against the runtime enums exported by the
pinned `@junction-api/sdk` package. The test has explicit exclusions for
Junction's lab, order, scheduling, internal-device, sleep-stream, and hypnogram
surfaces, plus explicit `body_fat`/`body_weight` aliases. An SDK upgrade that
adds or renames either a client-facing or timeseries resource therefore fails
the build until the resource is deliberately admitted, dedicated, excluded, or
added to the documented non-wearable exclusion set.

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

Junction timeseries are the concrete model for this boundary. Normal sync may fetch only policy-admitted, product-needed timeseries and must reduce them before persistence. The vault may keep tiny aggregate evidence such as `junction-timeseries-daily-*`, bounded workout-attributed facts, and capped `junction.workout_features.v1` envelopes, but it must not persist full `junction-timeseries-*` sample arrays or generic provider snapshots for dropped dense resources. Dense/debug streams such as steps, all-day distance, and heart rate, plus unsupported sparse resources such as weight, stay out of default sync unless a current product observation needs them. A dedicated workout stream is fetched only after its exact shallow webhook, reduced in memory, and discarded; route coordinates and every raw or downsampled series remain outside the importer boundary. Provider workout/session metrics belong under `activity_session.workout.metrics` or stable sibling measurement facets unless an explicit projector promotes derived daily facts; the closed companion Strain observation is the documented exception because its redacted identity cannot be joined safely to Junction's workout session. Wearable summaries require compact display-grade facts such as daily activity, sleep, or body observations.

### Observation metrics already in active use

Examples already present in the current providers include:
- activity and movement daily/display facts: `daily-steps`, `distance`, `active-calories`, `total-calories`, `floors-climbed`. Session-only workout values such as strain, recording percentage, elevation, speed, and workout heart rate belong under `activity_session.workout.metrics` unless an explicit projector emits display-grade observations.
- sleep and recovery: `sleep-total-minutes`, `time-in-bed-minutes`, `sleep-efficiency`, `sleep-score`, `recovery-score`, `readiness-score`
- cardiovascular and vitals: `resting-heart-rate`, `average-heart-rate`, `max-heart-rate`, `respiratory-rate`, `spo2`
- body and composition: `weight`, `bmi`, `body-fat-percentage`, `lean-body-mass`, `waist-circumference`, `systolic-blood-pressure`, `diastolic-blood-pressure`
- cycle and reproductive health: `cycle-day`, `period-day`, `cycle-length-days`, `period-length-days`, `pregnancy-week`
- deletion signaling: `external-resource-deleted`

If a provider needs a new metric family, stream, or naming surface, land that change intentionally and update this matrix in the same patch.
