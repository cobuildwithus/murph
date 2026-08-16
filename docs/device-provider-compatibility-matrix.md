# Device Provider Compatibility Matrix

Last verified: 2026-08-11

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
| Account/profile identity | Pull-capable | Resolve a stable `externalAccountId` during connect. Fetch profile data only when it materially helps later routing, display, or provenance. | Usually provenance plus a bounded `profile` evidence part. Junction profile summaries (one current snapshot per normalization revision) additionally land a `height` observation, a separate queryable `gender` categorical `measurement`, and one `note` event for birth date, biological sex, and wheelchair use. Gender is never substituted for or labeled as biological sex. | Retain profile payloads only as identity-sanitized evidence parts. A revised Junction profile normalizer invalidates only its existing revision marker, causing one bounded refresh on the next reconcile before returning to one-shot behavior. Keep stored runtime metadata shallow. | Garmin/Fitbit through Junction, WHOOP, Oura, Strava |
| Daily activity totals | Pull-capable | Backfill or reconcile bounded day windows. Webhooks optional. | `observation` metrics such as `daily-steps`, `distance`, `active-calories`, `total-calories` (including provider `energy-burned` aliases when only kilojoules are available), and `floors-climbed`. Junction activity summaries additionally preserve the validated `activity-minutes` sum alongside independent `low-activity-minutes`, `medium-activity-minutes`, and `high-activity-minutes` facts, plus `average-heart-rate`, `walking-average-heart-rate`, and `lowest-heart-rate` when the documented `heart_rate` fields are present. | Retain bounded daily-summary evidence parts and record imported sections in provenance. | Garmin/Fitbit through Junction, Oura, Strava |
| Sleep summary/session | Pull-capable; **push-primary for Garmin** (REST stale/empty → inline import authoritative, floor best-effort) | Fetch daily or rolling sleep windows; webhook hints optional. For Garmin, the direct sleep webhook import is the authoritative carrier. | `sleep_session` events plus `observation` metrics such as `sleep-total-minutes`, `time-in-bed-minutes`, `sleep-efficiency`, `sleep-score`, and `sleep-latency-minutes`. Junction's documented `latency` field is seconds and converts to canonical minutes; only explicitly minute-named variants bypass that conversion. | Retain bounded sleep-summary or session evidence parts. Do not invent stages or durations the provider did not send. | Garmin/Fitbit through Junction, Oura, WHOOP |
| Sleep stage timelines | Pull-capable; **push-primary for Garmin `sleep_cycle`** (REST stale/empty → inline import authoritative, floor best-effort) | Use the same windowing as sleep summary. Garmin `sleep_cycle` direct webhook import is the authoritative carrier. | Compact `observation` metrics only when the provider supplies display-grade stage durations; high-frequency stage timelines stay evidence-only. | Retain a bounded evidence part for the stage-bearing payload. Avoid coercing vague summary buckets into staged samples. | Garmin/Fitbit through Junction, Oura |
| Recovery / readiness | Pull-capable; foreground companion enrichment for WHOOP-keyed HealthKit metadata | Reconcile recent daily windows; webhook hints optional. The iOS companion may additionally send the exact `WHOOP Recovery` scalar from one `.inBed` sample per sleep session through the closed metadata route. | `observation` metrics such as `recovery-score`, `readiness-score`, `sleep-score-delta`, `readiness-score-delta`, `stress-level`, and `body-battery`. | Retain a bounded recovery or readiness evidence part plus day-level provenance. Companion records use a client-hashed HealthKit identity and Apple HealthKit provenance with an unverified WHOOP-metadata hint; never retain raw HealthKit identifiers or arbitrary metadata. | WHOOP, Oura, Garmin through Junction, WHOOP-keyed metadata through the iOS companion |
| Continuous vitals / timeseries | Pull-capable | Fetch bounded windows only when a current product fact needs them. Keep reconcile windows small enough to avoid duplicate churn. | Compact daily/session `observation` metrics or display-grade metric facts. Glucose retains mean, minimum, maximum, population standard deviation, and coefficient of variation; Apple HealthKit HRV maps to `hrv-sdnn`, while generic wearable HRV retains RMSSD semantics. Do not normalize provider firehose points into canonical sample rows. | Reduce samples in memory and retain only tiny aggregate evidence parts; full-fidelity timeseries retention requires an explicit product/debug policy and tests. | Garmin/Fitbit through Junction, WHOOP, Oura, Strava |
| Sparse physiological readings, intake, alerts, and interventions | Pull-capable; webhook notifications trigger the same pull owner | FEV1, FVC, heart-rate alerts, inhaler usage, peak flow, sleep-apnea alerts, falls, carbohydrates, and insulin injections are product-default labels. Each clinical resource is fetched as one resource/day, admits at most 128 provider records, and retains at most 100 deterministic facts. Metabolic history uses bounded 30-day chunks with at most 3,840 provider rows and 3,000 canonical facts. BMI, body fat, lean body mass, and waist circumference remain product opt-in labels while the exact production assembly still enables the exhaustive code-owned set. Member and environment overlays cannot change that set. | One per-reading `observation` for body, respiratory, carbohydrates, inhaler, fall, and typed alert counts; one `intervention_session` per insulin dose retaining amount/unit, interval, purpose, delivery form/mode, and insulin type. Irregular-rhythm alerts remain provider alert facts, never ECG diagnoses. | Preserve aggregator and source-provider provenance, source type/instance, timestamps/intervals, and same-time distinct identities. Libre fake-UTC wall times require one exact vault-zone instant; real nonzero offsets remain absolute, while gaps, overlaps, and mixed temporal domains fail closed. The canonical event spine retains the first accepted fallback-zone interpretation across profile-timezone changes; explicit row zones and changed raw wall times still correct the fact. Stable provider row IDs may inform hashed identity but never enter compact evidence. Fallback-zone evidence retains the provider wall-time interval rather than a replay-dependent derived instant. Retain one compact allowlisted evidence object per accepted record, plus a count-only overflow marker when needed and a raw-receipt digest; never retain grouped envelopes or historical arrays. Recheck source lifecycle after provider reads so reconnect races retry the same resource/window. | Explicitly configured Junction-backed sources |
| Automatic scheduled overnight PRV | Companion-only; no provider pull floor or backend capture scheduler by design | After one local Connect WHOOP enrollment, iOS continuously subscribes to the WHOOP 5/MG stream and automatically reduces the fixed `00:00–08:00` local civil-time occurrence into non-overlapping five-minute RMSSD windows using `prv-rmssd-5m-mean-scheduled-0000-0800-local-v1`. The schedule freezes that night's timezone rules; a fully traversed occurrence is bounded to 84...108 windows, typically 84/96/108 with intermediate counts such as 90/102 for half-hour shifts. Submit one nightly mean only after at least 48 accepted windows and at least 50% acceptance. A disconnect or process gap hard-breaks interval/window adjacency. Local enrollment sends no hosted lifecycle intent. Separately, known same-member passive SDK repair uses `resume`, while fresh/unproven install omits intent so server state resumes exactly one established lane, establishes only when zero provider rows exist, and rejects terminal/ambiguous state. Only a future visible hosted-health/Junction Reconnect action may send `connect`. | One immutable summary-grain `observation` per vault, `whoop` source, and `nightDate`, with metric `whoop-ble-overnight-prv-rmssd`, unit `ms`, synthetic 12:00Z `occurredAt`, no event `timeZone`, and direct-BLE/method provenance. It has no generic `hrv` or biomarker alias and stays distinct from Apple HealthKit `hrv-sdnn` plus the existing selected daily provider `hrv-rmssd` series. | Upload only `schema`, `methodVersion`, `nightDate`, `rmssdMs`, `completedWindowCount`, and `acceptedWindowCount`. Local persistence is limited to one OS-protected versioned scalar night checkpoint, at most three already-derived strict envelopes, and the exact app-scoped CoreBluetooth peripheral UUID needed to restore the enrolled band. That UUID never uploads or enters logs; raw intervals/packets, partial-window state, packet timestamps, every other band identifier, and per-window values remain memory-only. Exact capture timestamps/duration, timezone details, and coverage never upload or enter logs. One local watchdog reminder covers stopped callbacks; force-quit requires reopening Murph. Beta wellness PRV only until signed-iPhone WHOOP 5/MG and paired-ECG validation pass. | WHOOP 5/MG private BLE through the internal iOS companion |
| ECG recordings | Pull-capable | Fetch Junction electrocardiogram summaries by default. The code-owned production set separately enables `electrocardiogram_voltage`: fetch one-day grouped windows, admit at most 100,000 samples and 64 recordings, and reduce before snapshot retention. | The summary remains one complete `measurement` per recording. The dense opt-in writes an independent compact `measurement` containing sample count; min/max/mean/RMS, interval, unit, and lead count stay compact evidence. Its canonical owner is the stable provider recording ID plus exact source origin, so corrected timestamps and aggregates revise that fact rather than creating another one. It never diagnoses or classifies rhythm. | Retain one compact feature/evidence record per stable provider recording ID and exact source origin. Never retain or re-emit waveform samples, grouped envelopes, or sample-sized evidence. | Apple HealthKit, Withings, and Kardia through Junction |
| Workout / activity sessions | Pull-capable; foreground companion enrichment for WHOOP-keyed HealthKit metadata | Fetch list and detail endpoints. The code-owned production set separately enables Junction `workout_stream`, which admits at most 32 workouts per one-day index window, then fetches dedicated streams serially with at most 100,000 points per workout. The exact assembly has 48 production timeseries resources: 6 wide and 42 one-day resources, including 41 ordinary one-day resources plus `workout_stream`. Full-job timeseries continuations run one resource for one closed UTC day at a time. Ordinary collections allow at most three sequential pages, one attempt and eight seconds per page (24 seconds maximum provider wait); page-heavy hourly/session features retry as one complete hour, while daily aggregates remain day-atomic. `workout_stream` uses the same bounded three-page index and persists at most 32 canonical completed workout identities so yield or cancellation can resume between serial stream reads. Each reduced unit is imported before the scalar resource and window coordinate advance. A deployed v1 resource envelope is accepted only as read-only upgrade input and is immediately projected to its validated active scalar resource. Pagination remains in memory, and no vendor page cursor, provider row, waveform sample, or workout point enters job state. | Normal provider workouts remain complete `activity_session` events. The stream opt-in writes one independent compact `measurement` with duration, distance, heart-rate average/maximum, and stable workout identity. Its canonical owner is the stable provider workout ID plus exact source origin, so corrected timestamps and aggregates revise that fact. It cannot replace session calories, power, route, zones, or source details. | Retain one compact feature/evidence record per admitted workout and exact source origin. Continuation retains only the scalar resource/day coordinate and bounded workout identity strings, never completed-resource sets, timestamps beyond that coordinate, samples, waveform arrays, or stream arrays. Never retain stream points or sample-sized feature lists. | Garmin/Fitbit through Junction, WHOOP, Oura, Strava, WHOOP-keyed metadata through the iOS companion |
| Body measurements / composition | Pull-capable | Poll or fetch stable body endpoints only. When the provider returns current body state without a measurement id or timestamp, normalize it as an import-day snapshot instead of inventing history. | `observation` metrics such as `weight`, `bmi`, `body-fat-percentage`, `bone-mass-percentage`, `muscle-mass-percentage`, `body-water-percentage`, `visceral-fat-index`, `lean-body-mass`, `waist-circumference`, `systolic-blood-pressure`, `diastolic-blood-pressure`, and `spo2`. Junction body-summary `height` remains unmapped; profile owns height. | Retain one bounded measurement evidence part. Preserve Junction as aggregator plus the upstream provider and use stable metric-specific external-ref facets. | WHOOP body measurement, Oura daily SpO2, Junction-backed sources when configured |
| Meal / nutrition summaries | Pull-capable | Fetch Junction meal summaries by default for supported connect sources; keep broader nutrition expansions off default polling unless a product need proves them. | Canonical `meal` events with stable Junction-summary-derived `mealId` values, provider IDs as fallback identity only, item names as ingredients, nutrition totals for calories, protein, carbs, fat, fiber, and water, plus bounded documented micronutrients (`nutrition.micros`) with null/zero entries skipped. | Retain sanitized `junction-summary-meal` evidence parts for replay. | Junction meal summaries, including Cronometer-backed sources |
| Cycle / women-health | Pull-capable | Fetch bounded historical windows. Junction menstrual cycle summaries are on the default summary allowlist (~13 cycles per member-year). | Per-cycle `observation` metrics `period-length-days` and `cycle-length-days` (date-derived, falling back to explicit provider length fields) and dated `measurement` events for `menstrual-flow`, `cervical-mucus-quality`, `intermenstrual-bleeding`, `contraceptive-type`, `ovulation-test`, `pregnancy-test`, `home-progesterone-test`, `sexual-activity`, and `menstrual-cycle-deviation`. Categorical provider values remain bounded qualifiers; sexual activity preserves `protection-used` only when Junction supplies a boolean. Cervical mucus, contraceptive, deviation, and home-progesterone categories remain explicit, including unknown or indeterminate provider values. Unsupported flow categories and indeterminate ovulation or pregnancy results stay evidence-only. Predicted cycles stay excluded. Cycle basal-body-temperature sub-arrays stay evidence-only: the `basal_body_temperature` default timeseries is the canonical seam for that metric, and a second mapping here would land duplicate same-day observations dedupe cannot collapse. | Retain a bounded women-health evidence part. Avoid turning observations into diagnoses or upstream forecasts into facts. | Garmin; Junction menstrual cycle summaries by default |
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

Junction timeseries are the concrete model for this boundary. A compile-time policy in `@murphai/contracts` owns membership, product-default labeling, history mode, bounded fetch width, and normalization mode. Production explicitly supplies that policy's exhaustive canonical resource list, and omitted runtime configuration resolves to the same exhaustive list; an explicit programmatic subset remains exact. This keeps resource admission code-owned, with no member- or environment-owned expansion surface. `steps` and `distance` reduce to provider/source-partitioned closed-UTC-day observations plus `junction.timeseries_daily_aggregate.v1` evidence. `calories_active` and `heartrate` reduce to provider/source-partitioned UTC-hour features plus `junction.timeseries_feature_aggregate.v1` evidence; provider-local days and incomplete transport windows are not promoted. For both dense daily aggregates and hourly/session features, a documented point timestamp wins; otherwise interval start owns the unsplit provider scalar and its UTC day/hour bucket, with interval end used only as fallback. `weight` lands once per sparse reading as a canonical `measurement` with compact `junction.weight_reading.v1` evidence. Sparse physiological, intake, alert, and intervention resources reuse one generic owner and remain per-reading observations, typed alerts, or insulin interventions rather than daily averages. The next activity slice uses the same descriptor pipeline: `calories_basal`, `daylight_exposure`, `floors_climbed`, `stand_duration`, `stand_hour`, and `wheelchair_push` reduce to source-partitioned daily aggregates; `handwashing`, `uv_exposure`, `workout_distance`, `workout_duration`, and `workout_swimming_stroke` reduce to bounded UTC-hour features; and `fall` remains one sparse alert fact per provider record. Full-job continuations fetch one resource and one closed day at a time, and page-heavy hourly features adapt to one closed hour; provider calls remain sequential and every collection has a strict page, attempt, and request-time bound. Dense `electrocardiogram_voltage` and dedicated `workout_stream` reduce before snapshot retention into O(recordings/workouts) compact evidence independent of sample count. Their independent compact resource types use the stable provider recording/workout ID plus exact source origin as canonical identity, leaving timestamps and aggregates revisable. Workout streams use the workout index plus serial dedicated stream reads rather than the grouped-timeseries endpoint, and resumable progress uses the existing job payload. No path retains grouped provider envelopes, historical arrays, vendor page cursors, waveform/stream points, full provider snapshots, canonical sample rows, or invented coverage metadata. Summary and timeseries availability remain independent, and stream-derived facts use independent measurement resource types rather than the richer ECG summary or workout-session references.

### Observation metrics already in active use

Examples already present in the current providers include:
- activity and movement daily/display facts: `daily-steps`, `distance`, `active-calories`, `basal-calories`, `total-calories`, `daylight-exposure-minutes`, `floors-climbed`, `handwashing-count`, `stand-duration-minutes`, `stand-hours`, `uv-exposure-index`, `wheelchair-push-count`, `workout-distance-km`, `workout-minutes`, `swimming-stroke-count`, `activity-minutes`, `low-activity-minutes`, `medium-activity-minutes`, `high-activity-minutes`, and display-grade daily heart-rate facts such as `walking-average-heart-rate`. Session-only workout values such as strain, recording percentage, elevation, speed, and workout heart rate belong under `activity_session.workout.metrics` unless an explicit projector emits display-grade observations.
- sleep and recovery: `sleep-total-minutes`, `time-in-bed-minutes`, `sleep-efficiency`, `sleep-score`, `recovery-score`, `readiness-score`
- cardiovascular, respiratory, and alerts: `resting-heart-rate`, `average-heart-rate`, `max-heart-rate`, `respiratory-rate`, `spo2`, `forced-expiratory-volume-1`, `forced-vital-capacity`, `peak-expiratory-flow-rate`, `heart-rate-alert`, `sleep-apnea-alert`, `fall-count`
- body, composition, and sparse intake/action facts: `weight`, `bmi`, `body-fat-percentage`, `bone-mass-percentage`, `muscle-mass-percentage`, `body-water-percentage`, `visceral-fat-index`, `lean-body-mass`, `waist-circumference`, `systolic-blood-pressure`, `diastolic-blood-pressure`, `carbohydrates`, `inhaler-usage`; insulin doses remain `intervention_session` events rather than observation metrics
- cycle and reproductive health: `cycle-day`, `period-day`, `cycle-length-days`, `period-length-days`, `pregnancy-week`
- deletion signaling: `external-resource-deleted`

If a provider needs a new metric family, stream, or naming surface, land that change intentionally and update this matrix in the same patch.
