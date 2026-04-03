# Device Provider Compatibility Matrix

Last verified: 2026-04-03

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
| Account/profile identity | Resolve a stable `externalAccountId` during connect. Fetch profile data only when it materially helps later routing, display, or provenance. | Usually provenance plus a raw `profile` artifact, not a standalone canonical event by itself. | Retain profile payloads only as raw evidence when they are operator-useful. Keep stored runtime metadata shallow. | Garmin, WHOOP, Oura |
| Daily activity totals | Backfill or reconcile bounded day windows. Webhooks optional. | `observation` metrics such as `daily-steps`, `distance`, `energy-burned`, `active-calories`, and `floors-climbed`; optional `steps` samples when true timeseries exists. | Retain raw daily summary payloads and record imported sections in provenance. | Garmin, Oura |
| Sleep summary/session | Fetch daily or rolling sleep windows; webhook hints optional. | `sleep_session` events plus `observation` metrics such as `sleep-total-minutes`, `time-in-bed-minutes`, `sleep-efficiency`, `sleep-score`, and `sleep-latency-minutes`. | Retain raw sleep summaries or sessions. Do not invent stages or durations the provider did not send. | Garmin, Oura, WHOOP |
| Sleep stage timelines | Use the same windowing as sleep summary. | `sleep_stage` samples keyed to the provider's recorded stage windows. | Retain the stage-bearing raw payload. Avoid coercing vague summary buckets into staged samples. | Garmin, Oura |
| Recovery / readiness | Reconcile recent daily windows; webhook hints optional. | `observation` metrics such as `recovery-score`, `readiness-score`, `sleep-score-delta`, `readiness-score-delta`, `stress-level`, and `body-battery`. | Retain the raw recovery or readiness payload and day-level provenance. | WHOOP, Oura, Garmin |
| Continuous vitals / timeseries | Fetch bounded windows only. Keep reconcile windows small enough to avoid duplicate churn. | Sample streams such as `heart_rate`, `hrv`, `respiratory_rate`, `temperature`, and `steps`. | Retain the raw timeseries payload or upstream aggregate section that justified the normalized samples. | Garmin, WHOOP, Oura |
| Workout / activity sessions | Fetch list and detail endpoints. Use webhooks only when the provider offers reliable session updates or deletes. | `activity_session` events plus supporting observations such as `distance`, `average-heart-rate`, `max-heart-rate`, `workout-strain`, and `energy-burned`. | Retain raw activity or workout payloads. When files or assets exist, retain descriptors rather than synthesizing fake binary content. | Garmin, WHOOP, Oura |
| Body measurements / composition | Poll or fetch only when the provider exposes a stable endpoint with durable identifiers. | `observation` metrics such as `weight`, `bmi`, `body-fat-percentage`, `systolic-blood-pressure`, `diastolic-blood-pressure`, and `spo2`. | Retain the raw measurement payload and record measurement date in provenance. | WHOOP body measurement, Oura daily SpO2 |
| Cycle / women-health | Fetch bounded historical windows. | `observation` metrics such as `cycle-day`, `period-day`, `cycle-length-days`, `period-length-days`, and `pregnancy-week`. | Retain the raw women-health payload. Avoid turning probabilistic upstream state into certainty. | Garmin |
| Deletions / tombstones | Parse provider delete webhooks or API tombstones into explicit provider jobs. | `observation` events with metric `external-resource-deleted` and a deleted `externalRef` facet. | Retain the deletion payload so future replay can explain why an upstream record disappeared. | Garmin, WHOOP, Oura |
| Activity assets / file descriptors | Fetch metadata or descriptors only when they add real value. Do not default to large binary fetches. | Raw artifacts such as `activity-asset:*` tied back to the matching `activity_session`. | Keep descriptors or original asset payloads. Do not manufacture `.fit`, `.gpx`, or `.tcx` files from metadata-only endpoints. | Garmin |
| Webhook verification / admin | Implement `verifyAndParseWebhook()` and optional `webhookAdmin` only when the provider truly requires them. | No direct canonical mapping. Webhooks should still route into scheduled snapshot normalization. | Keep webhook traces small and safe. Store only the data needed for dedupe, replay, and debugging. | WHOOP, Oura challenge |

## Existing canonical shapes to prefer

When adding a provider, prefer these existing shapes before inventing new ones.

### Event kinds

- `observation`
- `sleep_session`
- `activity_session`

### Sample streams

- `heart_rate`
- `hrv`
- `respiratory_rate`
- `sleep_stage`
- `steps`
- `temperature`

### Observation metrics already in active use

Examples already present in the current providers include:
- activity and movement: `daily-steps`, `distance`, `energy-burned`, `active-calories`, `floors-climbed`
- sleep and recovery: `sleep-total-minutes`, `time-in-bed-minutes`, `sleep-efficiency`, `sleep-score`, `recovery-score`, `readiness-score`
- cardiovascular and vitals: `resting-heart-rate`, `average-heart-rate`, `max-heart-rate`, `respiratory-rate`, `spo2`
- body and composition: `weight`, `bmi`, `body-fat-percentage`, `systolic-blood-pressure`, `diastolic-blood-pressure`
- cycle and reproductive health: `cycle-day`, `period-day`, `cycle-length-days`, `period-length-days`, `pregnancy-week`
- deletion signaling: `external-resource-deleted`

If a provider needs a new metric family, stream, or naming surface, land that change intentionally and update this matrix in the same patch.
