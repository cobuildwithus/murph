# @murphai/device-syncd

Workspace-private local device sync runtime for Murph.

Contributing a new wearable provider? Start with `docs/device-provider-contribution-kit.md` in the repo root, then use the scaffolds listed in `docs/templates/README.md`.

Murph's CLI can install, start, reuse, and stop this daemon for the selected vault through `murph device daemon ...`, so most operators should treat it as a built-in local service rather than a separately managed sidecar.

The daemon binds the control plane to localhost by default. CLI and web clients must authenticate that control plane with a bearer token. If provider callbacks or webhooks need public reachability, expose only the public callback/webhook routes through a separate listener or reverse proxy instead of widening `/accounts/*` and `/providers/*/connect`.

The package now also exports a reusable `DeviceSyncPublicIngress` layer that encapsulates provider-agnostic OAuth state, callback handling, and webhook preflight/dispatch. Hosted or alternate HTTP surfaces should import that seam from `@murphai/device-syncd/public-ingress`; the package root stays daemon-oriented. That shared ingress is the seam used by the current hosted Vercel control plane while keeping the local/tunneled callback flow alive.
Daemon config readers and HTTP response helpers stay on `@murphai/device-syncd/config`
and `@murphai/device-syncd/http` instead of leaking back through the shared ingress seam.
Hosted surfaces should also reuse the configured-provider assembly helpers on
`@murphai/device-syncd/config` instead of maintaining app-local provider config objects
or registration lists.
For non-daemon callers, `@murphai/device-syncd/client` is the canonical shared control-plane client surface for base-url/token resolution, loopback safety checks, and JSON request helpers inside this workspace or bundled public tarballs.

What it does:
- serves a provider-agnostic local control plane for CLI and web auth flows
- owns OAuth connection state
- stores encrypted provider tokens in SQLite under `.runtime/operations/device-sync/state.sqlite`
- keeps `.runtime/operations/device-sync/**` local-only; those secrets, cursors, launcher artifacts, and logs are excluded from hosted workspace snapshots because the hosted lane uses a web-owned hosted device-sync control plane plus narrow signed runtime callbacks instead of the local daemon store
- treats the managed control bearer and managed OAuth encryption secret as separate local files, so bearer rotation does not invalidate encrypted provider tokens
- accepts provider webhooks when a provider supports them
- runs background backfill and reconcile jobs
- serializes active jobs per account so rotating refresh-token flows do not race
- may execute compatible already-durable jobs as bounded provider-owned batches while keeping job rows granular for retry, ack, and idempotency
- treats `DEVICE_SYNC_WORKER_BATCH_SIZE` as a durable job-row budget per tick; one provider batch may complete multiple rows, and each row counts against that budget
- imports provider snapshots through `@murphai/importers`

Canonical imports keep member-authored event revisions live while advancing
the connected-source baseline beneath them. Unrelated facts in the same
snapshot still commit atomically, omissions record provider tombstones beneath
member revisions, and exact retries are no-ops. This policy lives at the event
spine owner; device jobs, wakes, and hosted transports carry no parallel
conflict state or overwrite preference.

Current providers:
- Direct runtime providers: Oura, Strava, and WHOOP.
- Junction-backed sources come from `DEVICE_CONNECT_SOURCES`. `JUNCTION_PROVIDER_FILTER`
  selects Link targets such as Garmin and Fitbit; recognized Junction SDK sources such
  as Apple Health participate independently of that Link-only filter.
- Junction fetches the sparse `note` timeseries by default. Normalized tags from
  every admitted Junction source persist as neutral canonical notes. Personal
  Patterns currently derives an action factor only from the exact Oura `sauna`
  tag; other-source, symptom, context, outcome, and custom tags remain neutral.
  Free-text note values are dropped before raw snapshot and compact evidence
  retention. Note-history coverage version 2 reopens sources completed under
  the legacy intervention normalizer for one bounded semantic reimport, then
  records terminal source coverage again. The admitted resource-job payload
  freezes that generation across durable continuations and retries. Persisted
  unversioned work remains v1 after an upgrade and cannot certify or downgrade
  v2 coverage.
- Junction's product-default labels include `steps`, `distance`,
  `calories_active`, `heartrate`, `weight`, `carbohydrates`, and
  `insulin_injection`. Production configuration sets
  the exhaustive 48-resource registry explicitly, and omitting the list at the
  programmatic runtime seam resolves to that same registry. An explicit empty
  list disables all timeseries; an explicit non-empty list remains exact and
  rejects unknown names instead of substituting defaults.
- Opted-in `steps` and `distance` use provider/source-partitioned UTC-day aggregates.
  Opted-in `calories_active` and `heartrate` use provider/source-partitioned UTC-hour
  features. These identities match the complete closed-day import boundary instead
  of treating provider-local day or session fragments as complete facts. The four dense resources retain the bounded
  dense-timeseries fetch window and never persist raw sample arrays or full provider
  snapshots. Opted-in `weight` uses sparse canonical measurements with compact
  per-reading evidence and the fixed 180-day extended-history window.
- Seven sparse clinical and safety resources are product-default labels: FEV1,
  FVC, heart-rate alerts, inhaler usage, peak expiratory flow, sleep-apnea
  alerts, and falls. They retain the generic bounded timeseries horizon and are
  fetched in one-day units with at most 128 provider records, retaining at most
  100 deterministic canonical facts;
  an overflow leaves only a compact count marker. The source lifecycle epoch
  is checked again after each provider read so a reconnect retries the same
  resource/day instead of importing a stale response. Stable provider row IDs
  may inform hashing but are omitted from compact evidence.
- Carbohydrates and insulin injections use bounded 30-day history chunks with
  at most 3,840 provider rows and 3,000 deterministic canonical facts. Libre's
  documented fake-UTC wall times are admitted only when the vault timezone
  identifies one exact instant; real nonzero offsets stay absolute, while DST
  gaps, overlaps, and mixed floating/absolute intervals fail closed. The first
  accepted fallback-zone interpretation belongs to the existing canonical event
  spine, so later profile-timezone changes cannot rewrite only the recently
  replayed portion of history. Explicit row zones and changed raw wall times
  remain authoritative corrections. The lifecycle fence rechecks the source
  after each fetch before import.
- BMI, body fat, lean body mass, and waist circumference remain product opt-in
  labels. The production provider assembly
  still enables the exhaustive exact code-owned registry; member overlays and
  environment variables cannot widen or narrow it. These four resources retain
  the fixed 180-day extended-history window in bounded 30-day fetch chunks.
  `fat` remains the public resource name while the
  client requests Junction's `body_fat` path.
- `electrocardiogram_voltage` and `workout_stream` are separate exact opt-ins in
  that same code-owned production set. ECG voltage uses one-day grouped windows capped at
  100,000 admitted samples and 64 recordings, then reduces each recording to one
  clinically neutral feature record before a sync snapshot exists. Workout stream
  uses the ordinary workout index only to admit at most 32 stable workouts per
  one-day window, then reads Junction's dedicated per-workout stream endpoint
  serially and caps each stream at 100,000 points. The exact production assembly has
  48 production timeseries resources: 6 wide and 42 one-day resources, including
  41 ordinary one-day resources plus `workout_stream`. A full-job continuation owns one resource
  and one closed UTC day. An ordinary collection permits at most three sequential
  pages with one attempt and an eight-second timeout per page, limiting provider
  wait to 24 seconds. A page-heavy hourly/session feature retries as one complete
  hour; daily aggregates remain day-atomic. Workout streams use the same bounded
  three-page index and carry only at-most-32 completed workout identities between
  serial stream reads. Each reduced unit is imported before the scalar resource
  and window coordinate advance. A deployed v1 resource envelope is accepted
  only as read-only upgrade input and its validated active resource is immediately
  rewritten as a scalar successor. Pagination remains in memory, and no provider
  row, vendor page cursor, waveform sample, or workout point enters job state.
  Each dedicated stream response is capped at 8 MiB before SDK parsing. Reduction
  keeps only duration, distance, heart-rate shape, cadence, power, speed, and at
  most 64 interpolated fixed-distance splits. Running/walking cadence uses
  steps-per-minute, cycling cadence uses rpm, and swimming uses 100-meter rather
  than 1-kilometer splits. Newer versions authoritatively withdraw omitted split
  facets. Raw points, coordinates, complete curves, and provider arrays never
  cross the importer boundary. The rebuildable query projection groups live
  feature facets once by their internal hashed workout identity; the existing
  `wearables activity list` filtered summary read exposes only provider, sport,
  timestamps, unit-bearing compact metrics, and splits for each workout. This
  adds no control-database collection path, pooled transaction, foreground
  full-vault hydration, or sample persistence. Each present workout metric
  array must align with the timestamp array. A workout whose present metric
  arrays do not align is skipped so one malformed stream cannot block other
  workouts or replace a previously complete canonical measurement; the skip
  emits a metadata-only cardinality warning for provider follow-up.
- Successful Junction resource/webhook jobs preserve the full-sync completion
  watermark. They still complete and clear their own failures, while only a
  terminal reconcile or backfill whose window ends at the current closed-day
  horizon can prove the configured collection ran.
- Only the closed date-by-date Junction fetch path may authorize blood-oxygen
  and stress temporal features. Precise resource windows and webhook-driven
  imports keep ordinary compact facts but cannot publish temporal features from
  partial windows. Each successful complete resource/day owns its fixed
  `temporal-*` facet set through existing authoritative event sets, so a
  successful empty or insufficient replacement retracts stale derived facts;
  failed or yielded work grants no authority.
- The temporal horizon is clamped to 1–14 authoritative vault-local days. The
  newest eligible day imports inline, while older resource/day coordinates use
  the existing durable queue in newest-first order. Queued or running work
  deduplicates across restarts, while succeeded rows remain history rather than
  suppressing a later scheduled pull whose source roster or provider data may
  have widened. At the failure/yield ceiling, 28 temporal rows plus one ordinary
  reconcile follow-up remain serialized by the existing per-account fence.
- Temporal children never advance generic account completion. That watermark is
  account activity state rather than complete floor coverage, so every scheduled
  reconcile still refetches configured ordinary resources. Collection remains
  capped at 100 pages and 25,000 records with at most three attempts per page;
  reduction persists bounded scalar evidence and never full timeseries values.

Use `packages/device-syncd/src/config/connect-routes.ts` as the source of truth
for the current connect target catalog, and use
`packages/importers/src/device-providers/provider-descriptors.ts` for provider
descriptor support.

## Shared public ingress

Use `DeviceSyncPublicIngress` when you need the same callback/webhook logic in a different HTTP surface:
- local `device-syncd` with an exposed public listener or tunnel
- the current hosted Next.js/Vercel control plane that stores durable integration state in Postgres

The shared ingress owns:
- provider connect URL creation
- OAuth state validation
- OAuth callback completion
- provider-owned webhook preflight plus webhook parsing
- webhook dedupe and account lookup hooks

When a provider's verified webhook envelope includes a signed send timestamp,
the provider parser exposes it as `providerSentAt`. This is distinct from the
provider event's `occurredAt` and the shared ingress receipt time. Generic
ingress carries only those typed timestamps and the stripped webhook summary;
it never forwards signature headers or raw provider payloads as observability
metadata. Junction, Oura, WHOOP, and Strava currently expose verified send
times. Provider adapters likewise omit top-level `occurredAt` when the signed
payload does not identify the event time, even if an import window needs a
receipt-time fallback internally. A missing timestamp means the provider did
not supply a verified one, not that Murph should infer it.

Hosted Queue admission freezes that verified meaning as
`murph.device-sync-prepared-webhook.v1` before acknowledging the provider. The
prepared event contains no raw signature headers or raw provider body. Delayed
admission therefore survives provider-secret, parser, and timestamp-window
rotation without verifying the same payload again, while current provider,
connection, consent, source, and provider-application authority is still
rechecked. A prepared-event decoder may be retired only after main Queue, DLQ,
and every supported redrive path are proven free of its schema version.

It does **not** own canonical health-data import. The local data plane should still be the only component that normalizes provider payloads and writes them into the Murph vault.
It also does **not** own provider-specific webhook-admin secrets. If a provider
needs verification or subscription credentials, keep them on that provider's
config and factory path instead of widening the generic ingress or daemon
HTTP/env shapes.

## Provider model

`device-syncd` treats wearable providers as long-lived connectors with a shared lifecycle:
- one-time OAuth connect
- encrypted token storage with refresh support
- initial backfill
- scheduled reconcile polling
- optional webhook fan-in
- normalized snapshot import through `@murphai/importers`

Garmin and other hosted `/connect` targets use Junction Link when Junction credentials
are configured. Leave `JUNCTION_PROVIDER_FILTER` unset or empty to use the shared Link
defaults; set it only to narrow the enabled Link targets for an environment. Recognized
Junction SDK sources, including Apple Health, are resolved from the same connect-route
catalog and remain eligible for historical coverage without appearing in that filter.

Junction connect-time history is tracked per advertised high-signal daily
source/resource pair (activity, sleep, and `sleep_cycle`), not by a single
account-level "has data" flag. An activity row therefore cannot close a missing
sleep obligation. Availability describes capability, so empty sparse resources
such as workouts or body measurements do not become failed-export signals.
`@murphai/importers` is the sole owner of summary semantics: the same adapter
that performs canonical import emits bounded source/resource normalization
evidence for fallback coverage checks. `device-syncd` does not maintain a
second raw-payload metric parser.

Junction timeseries use one exhaustive static history policy. Dense/default
resources, ECG voltage, workout streams, and ordinary full-timeseries collection
keep the generic bounded initial window (14 days by default, configurable through
`timeseriesBackfillDays`). The existing extended set—`afib_burden`,
`basal_body_temperature`, `blood_pressure`, `body_temperature`,
`body_temperature_delta`, `caffeine`, `heart_rate_recovery_one_minute`,
`mindfulness_minutes`, `note`, `sleep_breathing_disturbance`, `vo2_max`, `water`,
`weight`, `body_mass_index`, `carbohydrates`, `fat`, `insulin_injection`,
`lean_body_mass`, and `waist_circumference`—always starts with an explicit
180-day window independent of both the generic timeseries window and
`summaryBackfillDays`. The existing source-scoped sparse-history jobs fetch
policy-sized one- or 30-day chunks, serialize per account, and record terminal
coverage in compact
connection metadata; they do not add another queue or lifecycle. Blood pressure
keeps exact per-reading completion, and note history keeps complete-fetch
semantics. All extended timeseries completion shares one fixed-width,
source-by-resource matrix in an existing blood-pressure or note metadata slot.
The shorter pre-metabolic matrix zero-extends on its next write; older legacy
values still read, and unsupported route identities fail before history
egress rather than advancing an unretainable checkpoint. Every date-mode
timeseries fetch preserves one complete provider
calendar date during both migration and normal reconcile; a provider-bearing
date with any row rejected by the canonical aggregate parser retries only that
date on the existing bounded ladder. Historical-pull status is re-read before
coverage, with supported connect-route aliases canonicalized on both sides:
matching pulled state takes precedence, success permits terminal empty history,
nonterminal state waits, and explicit failure remains uncovered. Explicit
`not_pulled` is no obligation only without a pulled entry, while unavailable
status requires canonical history evidence. Delayed work derives
the live reconcile boundary after every completed segment and continues until
no middle gap remains. An explicit timeseries backfill override still governs
every timeseries resource.

Junction's historical-pull status is authoritative when available. A `success`
completes its source/resource obligation even when the provider reports zero
rows, and Murph does not compare provider-specific history ranges with its own
connect window. `not_pulled` is not an obligation. Scheduled, in-progress,
retrying, unknown, malformed, or unavailable status remains pending on the
existing daily retry cadence; none of those states can request a reset.
Canonical normalization evidence and authenticated old-window push evidence
provide the bounded fallback when introspection is unavailable.

Connection metadata owns the aggregate retry status, attempt count, and daily
cadence across all pending sources. Garmin's connection-source row separately
owns reset eligibility. Once the observation ladder is saturated, an explicit
Junction `failure` for every still-pending Garmin obligation can mark Garmin
reconnect-required while aggregate metadata remains `retrying` for another
provider. Successful Garmin coverage clears that source marker without waiting
for the other provider. Current ingestion remains active throughout.

Restarting the Garmin export requires the member to confirm the existing
connection-wide disconnect and then reconnect Garmin. The reset can disconnect
other wearables on the same Junction connection, so its scope must be explained
before confirmation. If provider-side deregistration fails, the local
disconnect still stands and the member must remove the connection in the Garmin
account before reconnecting.

Ordinary removal of a healthy Junction-backed source is source-scoped. Hosted
Web deregisters only the selected provider slug and leaves the shared Junction
account, its credentials, and sibling source rows active. The connection-wide
path above is reserved for the explicit historical-export reset. Obsolete Link
completion is followed by exact-target cleanup, and repeated removal rechecks
provider state so a local disconnected row is never treated as proof of remote
revocation. A reconnect Link carries the exact pending source epoch through URL
creation and is returned only if that epoch is still current. Obsolete Link
completion that overlaps provider cleanup advances the same exact-source
operation and performs another idempotent target-only deregistration before the
initiating operation can converge on success.

WHOOP uses OAuth plus webhooks.
Strava uses OAuth, polling, and optional app-global webhooks.

Oura uses OAuth plus refresh tokens and works well in a polling-first mode, so the basic Murph setup does not require Oura webhooks. Once the operator configures the Oura client ID and secret, the end-user flow is just connect once and let scheduled sync keep the account fresh.

The companion WHOOP 5/MG overnight-PRV lane is not another provider scheduler.
After one explicit mobile enrollment, iOS continuously subscribes and owns the
fixed local `00:00–08:00` reduction using
`prv-rmssd-5m-mean-scheduled-0000-0800-local-v1`; `device-syncd` receives only
one strict six-field summary for the resulting `nightDate`. A fully traversed
frozen occurrence is bounded to 84...108 five-minute windows, typically
84/96/108 with intermediate counts such as 90/102 for half-hour shifts. The
phone's protected scalar checkpoint, exact app-scoped CoreBluetooth peripheral
UUID, outbox bookkeeping, and local watchdog reminder never enter this runtime;
only an individual strict six-field envelope does. The UUID never uploads or
enters logs. The hosted encrypted payload
remains the retry owner until
canonical success or exact structural invalidity, and this package does not
add a nightly job, per-window rows, or a sleep detector.

Companion lifecycle intent is also closed. The local Connect WHOOP action
enrolls only the CoreBluetooth band and sends no hosted `connect`. A known
same-member passive SDK repair sends `resume`; a fresh or unproven installation
omits intent so durable server state resumes exactly one established lane,
establishes only when zero provider rows exist, and rejects terminal or
ambiguous state. Only a future visible hosted-health/Junction Reconnect action
may send `connect` and create/reactivate the shared lane. Resume, omitted intent,
data ingress, and retry work cannot undo an explicit disconnect.
That explicit Apple Health connect captures the current source epoch before SDK
token mint and opens one pending epoch afterward only if the proof remains
current. A signed Junction source-registration event reconciles that unchanged
pending epoch against the live provider list and commits it connected; the same
event target-cleans a fenced source or disconnected parent.
Apple Health companion metadata, WHOOP overnight summaries, and their queued
runtime jobs reread and honor the exact-source disconnect state immediately
before import instead of trusting queued account state. Webhook receipt time and
health-record occurrence time are not source-registration proof. WHOOP
summaries keep `whoop` as data provenance while their authorization is checked
against the disconnectable Junction `whoop_v2` source.

The provider lifecycle metadata used here now comes from the shared `@murphai/importers/device-providers/provider-descriptors` surface, so callback paths, default scopes, webhook capabilities, sync windows, metric families, and source-priority hints stay aligned between connector code and snapshot normalization.
The configured-provider assembly composes a lightweight hosted-runtime config schema from `packages/device-syncd/src/config/serializable-provider-configs.ts` into the full registry in `packages/device-syncd/src/config/provider-manifests.ts`. Serialization fields and secret exclusions therefore have one boot-safe owner, while descriptors, provider-owned jobs, and runtime adapters stay outside the hosted runner's static boot closure. Hosted web and runner startup can read provider config without importing the provider implementation graph.
Junction timeseries membership, defaults, opt-in admission, history mode, fetch
width, and storage mode are compile-time projections of
`packages/contracts/src/junction-resources.ts`; importer and scheduler code add only
the shape-specific canonicalization and execution they own. An explicit
`timeseriesResources` list is exact: blocked or unknown names never expand to
defaults.

Provider request failures emit a shared, metadata-only diagnostic shape. Logs and hosted runtime apply payloads may include endpoint kind, method, auth placement, body/query field names and counts, upstream status, response shape, and a sanitized provider error code/description. They must not include provider tokens, client secrets, auth codes, raw request bodies, raw response bodies, raw provider paths, query values, or provider account identifiers. New provider transports should use the shared provider diagnostics helpers instead of adding provider-specific ad hoc logging.

## Adding another provider

The permanent provider path is:
- add one shared descriptor in `@murphai/importers`
- add one `packages/device-syncd/src/providers/<provider>.ts` transport module that owns auth, refresh, jobs, and any provider-owned webhook preflight/admin behavior
- add one importer adapter in `packages/importers/src/device-providers/<provider>.ts`
- define its boot-safe serialization schema in `packages/device-syncd/src/config/serializable-provider-configs.ts`, then compose that schema into its registration in `packages/device-syncd/src/config/provider-manifests.ts`

Hosted web should not need a second provider registry or a provider-specific
Prisma table for a normal addition. Its Postgres device-sync models stay
provider-generic, and its route layer should keep using the shared
`DeviceSyncPublicIngress` seam.

Provider-readiness checkpoint:
- a normal provider addition should stop at the descriptor, transport module, importer adapter, boot-safe serialization schema, and provider-manifest registration
- generic hosted or local ingress should not gain provider-specific webhook secrets, provider-specific route branching, or provider-specific persistence tables
- if a provider seems to need edits outside those seams, treat it as an architecture review instead of routine provider wiring

## Environment

Required:
- `DEVICE_SYNC_VAULT_ROOT`
- `DEVICE_SYNC_PUBLIC_BASE_URL`
- `DEVICE_SYNC_SECRET` for the daemon's local bootstrap/service secret
- `DEVICE_SYNC_CONTROL_TOKEN` for the control-plane bearer token

Those two secrets are part of the local daemon contract. The hosted execution path uses signed internal web routes and hosted agent/session credentials instead of the daemon's `DEVICE_SYNC_CONTROL_TOKEN`.

At least one provider must be configured.

Common optional settings:
- `DEVICE_SYNC_PORT`
- `DEVICE_SYNC_HOST` (defaults to `127.0.0.1`)
- `DEVICE_SYNC_ALLOWED_RETURN_ORIGINS`
- `DEVICE_SYNC_STATE_DB_PATH`
- `DEVICE_SYNC_WORKER_POLL_MS`
- `DEVICE_SYNC_WORKER_BATCH_SIZE`
- `DEVICE_SYNC_SCHEDULER_POLL_MS`
- `DEVICE_SYNC_SESSION_TTL_MS`
- `DEVICE_SYNC_WORKER_LEASE_MS`
- `DEVICE_SYNC_PUBLIC_HOST` plus `DEVICE_SYNC_PUBLIC_PORT` to expose only `/oauth/*/callback` and `/webhooks/*`

WHOOP settings:
- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
- `WHOOP_BASE_URL`
- `WHOOP_SCOPES`
- `WHOOP_BACKFILL_DAYS`
- `WHOOP_RECONCILE_DAYS`
- `WHOOP_RECONCILE_INTERVAL_MS`
- `WHOOP_WEBHOOK_TIMESTAMP_TOLERANCE_MS`
- `WHOOP_REQUEST_TIMEOUT_MS`

Oura settings:
- `OURA_CLIENT_ID`
- `OURA_CLIENT_SECRET`
- `OURA_AUTH_BASE_URL`
- `OURA_API_BASE_URL`
- `OURA_SCOPES`
- `OURA_BACKFILL_DAYS`
- `OURA_RECONCILE_DAYS`
- `OURA_RECONCILE_INTERVAL_MS`
- `OURA_REQUEST_TIMEOUT_MS`
- `OURA_WEBHOOK_VERIFICATION_TOKEN` when you want the Oura provider config to answer webhook preflight challenges and run connect-time Oura webhook subscription upkeep

Strava settings:
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- `STRAVA_AUTH_BASE_URL`
- `STRAVA_API_BASE_URL`
- `STRAVA_SCOPES`
- `STRAVA_BACKFILL_DAYS`
- `STRAVA_RECONCILE_DAYS`
- `STRAVA_RECONCILE_INTERVAL_MS`
- `STRAVA_REQUEST_TIMEOUT_MS`
- `STRAVA_WEBHOOK_SIGNING_SECRET` when direct Strava webhook POST delivery is enabled; Strava POST events fail closed without a valid `X-Strava-Signature`
- `STRAVA_WEBHOOK_TIMESTAMP_TOLERANCE_MS`
- `STRAVA_WEBHOOK_VERIFY_TOKEN` when you want the Strava provider config to answer webhook preflight challenges and maintain the single app-global Strava webhook subscription

## Run

```bash
# from the repo root
node packages/device-syncd/dist/bin.js
```
