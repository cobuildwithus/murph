# Device Provider Compatibility Matrix

Last verified: 2026-05-27

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

| Family | `device-syncd` expectation | `importers` target | Evidence + provenance expectation | Current examples |
| --- | --- | --- | --- | --- |
| Account/profile identity | Resolve a stable `externalAccountId` during connect. Fetch profile data only when it materially helps later routing, display, or provenance. | Usually provenance plus a raw `profile` artifact, not a standalone canonical event by itself. | Retain profile payloads only as raw evidence when they are operator-useful. Keep stored runtime metadata shallow. | Garmin/Fitbit through Junction, WHOOP, Oura, Strava |
| Daily activity totals | Backfill or reconcile bounded day windows. Webhooks optional. | `observation` metrics such as `daily-steps`, `distance`, `active-calories`, `total-calories` (including provider `energy-burned` aliases when only kilojoules are available), and `floors-climbed`. | Retain raw daily summary payloads and record imported sections in provenance. | Garmin/Fitbit through Junction, Oura, Strava |
| Sleep summary/session | Fetch daily or rolling sleep windows; webhook hints optional. | `sleep_session` events plus `observation` metrics such as `sleep-total-minutes`, `time-in-bed-minutes`, `sleep-efficiency`, `sleep-score`, and `sleep-latency-minutes`. | Retain raw sleep summaries or sessions. Do not invent stages or durations the provider did not send. | Garmin/Fitbit through Junction, Oura, WHOOP |
| Sleep stage timelines | Use the same windowing as sleep summary. | Compact `observation` metrics only when the provider supplies display-grade stage durations; high-frequency stage timelines stay raw evidence. | Retain the stage-bearing raw payload. Avoid coercing vague summary buckets into staged samples. | Garmin/Fitbit through Junction, Oura |
| Recovery / readiness | Reconcile recent daily windows; webhook hints optional. | `observation` metrics such as `recovery-score`, `readiness-score`, `sleep-score-delta`, `readiness-score-delta`, `stress-level`, and `body-battery`. | Retain the raw recovery or readiness payload and day-level provenance. | WHOOP, Oura, Garmin through Junction |
| Continuous vitals / timeseries | Fetch bounded windows only. Keep reconcile windows small enough to avoid duplicate churn. | Raw evidence plus compact daily/session `observation` metrics when the upstream payload already provides display-grade facts. Do not normalize provider firehose points into canonical sample rows. | Retain the raw timeseries payload or upstream aggregate section that justified any compact metric. | Garmin/Fitbit through Junction, WHOOP, Oura, Strava |
| Workout / activity sessions | Fetch list and detail endpoints. Use webhooks only when the provider offers reliable session updates or deletes. | `activity_session` events with session-scoped workout detail under `workout`, including compact `workout.metrics` for values such as calories, heart rate, HRV, strain, speed, elevation, and recording quality. Daily/queryable activity rollups require explicit summary observations or a later projector; normal read paths should not infer them from raw workout payloads. | Retain raw activity or workout payloads. When files or assets exist, retain descriptors rather than synthesizing fake binary content. | Garmin/Fitbit through Junction, WHOOP, Oura, Strava |
| Body measurements / composition | Poll or fetch stable body endpoints only. When the provider returns current body state without a measurement id or timestamp, normalize it as an import-day snapshot instead of inventing history. | `observation` metrics such as `weight`, `bmi`, `body-fat-percentage`, `lean-body-mass`, `waist-circumference`, `systolic-blood-pressure`, `diastolic-blood-pressure`, and `spo2`. | Retain the raw measurement payload and record the effective measurement day in provenance when the provider omits a timestamp. | WHOOP body measurement, Oura daily SpO2, Junction-backed sources when configured |
| Meal / nutrition summaries | Fetch only when explicitly configured; keep off default wearable polling lists. | Raw artifact evidence only until there is a deliberate meal/nutrition import contract for provider data. | Retain sanitized `junction-summary-meal` payloads for assistant inspection without creating canonical meal rows. | Junction when configured |
| Cycle / women-health | Fetch bounded historical windows. Junction menstrual cycle summaries stay off defaults and are fetched only when explicitly configured. | `observation` metrics such as `cycle-day`, `period-day`, `cycle-length-days`, `period-length-days`, and `pregnancy-week`; Junction menstrual cycle summaries remain raw-only until we deliberately map their richer fields. | Retain the raw women-health payload. Avoid turning probabilistic upstream state into certainty. | Garmin; Junction raw-only when configured |
| Deletions / tombstones | Parse provider delete webhooks or API tombstones into explicit provider jobs. | `observation` events with metric `external-resource-deleted` and a deleted `externalRef` facet. | Retain the deletion payload so future replay can explain why an upstream record disappeared. | Garmin/Fitbit through Junction, WHOOP, Oura, Strava when provider data supports it |
| Activity assets / file descriptors | Fetch metadata or descriptors only when they add real value. Do not default to large binary fetches. | Raw artifacts such as `activity-asset:*` tied back to the matching `activity_session`. | Keep descriptors or original asset payloads. Do not manufacture `.fit`, `.gpx`, or `.tcx` files from metadata-only endpoints. | Garmin through Junction, Strava |
| Webhook verification / admin | Implement `verifyAndParseWebhook()` and optional `webhookAdmin` only when the provider truly requires them. | No direct canonical mapping. Webhooks should still route into scheduled snapshot normalization. | Keep webhook traces small and safe. Store only the data needed for dedupe, replay, and debugging. | WHOOP, Oura challenge, Strava direct, Junction |

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

These streams are reserved for explicit CSV/import/debug sample ledgers. Provider adapters should prefer raw artifacts plus compact observation metrics and should not emit high-frequency wearable telemetry as normal canonical samples.

Junction timeseries are the concrete model for this boundary: `junction-timeseries-*` raw artifacts are evidence/debug data only. They must not emit per-point observation events, appear in default read/search surfaces, or feed wearable summaries by themselves. Dense Junction timeseries are tagged for short-lived debug retention and pruned by the hosted post-device-sync retention pass; sparse resources such as `weight` remain raw evidence unless a separate policy changes that. Provider workout/session metrics belong under `activity_session.workout.metrics` unless an explicit projector promotes derived daily facts. Wearable summaries require compact display-grade facts such as daily activity, sleep, or body observations.

### Observation metrics already in active use

Examples already present in the current providers include:
- activity and movement daily/display facts: `daily-steps`, `distance`, `active-calories`, `total-calories`, `floors-climbed`. Session-only workout values such as strain, recording percentage, elevation, speed, and workout heart rate belong under `activity_session.workout.metrics` unless an explicit projector emits display-grade observations.
- sleep and recovery: `sleep-total-minutes`, `time-in-bed-minutes`, `sleep-efficiency`, `sleep-score`, `recovery-score`, `readiness-score`
- cardiovascular and vitals: `resting-heart-rate`, `average-heart-rate`, `max-heart-rate`, `respiratory-rate`, `spo2`
- body and composition: `weight`, `bmi`, `body-fat-percentage`, `lean-body-mass`, `waist-circumference`, `systolic-blood-pressure`, `diastolic-blood-pressure`
- cycle and reproductive health: `cycle-day`, `period-day`, `cycle-length-days`, `period-length-days`, `pregnancy-week`
- deletion signaling: `external-resource-deleted`

If a provider needs a new metric family, stream, or naming surface, land that change intentionally and update this matrix in the same patch.
