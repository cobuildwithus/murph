# Junction Greenfield Primitive V2

Status: active
Created: 2026-04-30
Updated: 2026-05-01

## Current Follow-Up

- 2026-05-01: Fix timeseries chunk over-fetch/import duplication by deduping chunk results before snapshot import. Adjacent Junction chunks are converted to date-only API params, so date-inclusive provider behavior can return the same sample in neighboring chunks. Focused Junction provider test and package-local device-syncd typecheck passed; full package/root checks remain blocked by unrelated dirty-tree failures recorded in handoff.

## Purpose

This active plan supersedes the completed snapshot at `agent-docs/exec-plans/completed/2026-04-30-add-junction-greenfield-primitive-update.md` for future Junction work. The completed file remains immutable history. This revision folds in the latest review feedback before the next implementation wave.

The core architecture remains:

```txt
connection flow       how the user connects
account credential    how Murph authenticates later API calls
data origin           where a normalized wearable record really came from
```

For Junction:

```txt
provider              junction
connection.kind       external_link
credential.kind       provider_config
externalAccountId     Junction user_id
data origin           upstream Junction source/device/app
externalRef.system    junction
```

## Non-Negotiable Fixes

- Use `external_link`, not `hosted_link`.
- Make `DeviceAccountCredential` first-class across storage, public account upsert, hosted runtime snapshots, hydration, token export, token refresh, disconnect, revoke, and job context.
- Store provider config profiles, not secret refs, in account rows: `credential_kind = "provider_config"` plus `provider_config_key = "junction"`.
- Built-in provider manifest credential policy is authoritative over provider instance fields. Provider-config credentials must not be accepted for an OAuth manifest provider.
- Do not store raw owner ids, raw `client_user_id`, Junction API keys, HMAC secrets, or webhook secrets in account metadata or runtime snapshots.
- Persist the Junction parent account before redirect through an ingress-owned `connectionSeed` contract.
- Keep lifecycle `status` scoped to account health. Model pending external-link setup with `setupPhase` and `setupExpiresAt`, not `status = "connecting"`.
- Settings/status surfaces must treat `setupPhase` as an overlay on lifecycle status so an active pending-link parent is findable by webhook/reconcile without looking fully connected to the user.
- External-link callbacks must match the seeded parent account and preserve bounded setup expiry while the account is still pending Link confirmation.
- Provider callback results cannot contain both new `credential` material and legacy `tokens`; mixed material is rejected instead of guessed.
- Make `DeviceDataOrigin` real before importing Junction data; it is not a substitute for the source projection table.
- Keep Junction provider priority lower than direct Oura/Garmin/WHOOP/Strava until source-aware query policy exists.

## Descriptor Primitives

Add connection flow metadata to shared provider descriptors. Keep credential policy in the device-sync provider manifest because it is runtime/storage authority, not importer/catalog behavior:

```ts
export type DeviceConnectionFlowKind =
  | "oauth2"
  | "external_link"
  | "sdk"
  | "manual"
  | "none";

export interface DeviceProviderConnectionDescriptor {
  kind: DeviceConnectionFlowKind;
  callbackPath?: string;
  defaultScopes?: readonly string[];
}

export interface DeviceProviderDescriptor {
  provider: string;
  displayName: string;
  transportModes: readonly DeviceProviderTransportMode[];
  connection?: DeviceProviderConnectionDescriptor;
  oauth?: DeviceProviderOAuthDescriptor;
  webhook?: DeviceProviderWebhookDescriptor;
  sync?: DeviceProviderSyncDescriptor;
  normalization: DeviceProviderNormalizationDescriptor;
  sourcePriorityHints: DeviceProviderSourcePriorityHints;
}
```

Device-sync manifests own credential policy:

```ts
export type DeviceProviderCredentialPolicy =
  | { kind: "oauth_tokens" }
  | { kind: "provider_config"; providerConfigKey: string }
  | { kind: "none" };
```

This is a security boundary. Ingress/storage must validate:

```txt
oauth_tokens policy:
  credential.kind = oauth_tokens

provider_config policy:
  credential.kind = provider_config
  credential.providerConfigKey = the provider manifest/config key

none policy:
  credential.kind = none
```

This prevents arbitrary `providerConfigKey` values from being smuggled into account rows.

## Connection Contract

Providers can use generic connection hooks:

```ts
export interface ProviderConnectionSeed {
  externalAccountId: string;
  displayName?: string | null;
  status?: "active" | "reauthorization_required" | "disconnected";
  setupPhase?: "pending_link" | "link_returned" | "source_confirmed" | "failed";
  setupExpiresAt?: string;
  scopes?: string[];
  metadata?: Record<string, unknown>;
  credential: DeviceAccountCredential;
  nextReconcileAt?: string | null;
}

export interface ProviderBeginConnectionResult {
  authorizationUrl: string;
  connectionSeed?: ProviderConnectionSeed;
  stateMetadata?: Record<string, unknown>;
}
```

Public ingress owns persistence:

```txt
provider.beginConnection()
  returns authorizationUrl, connectionSeed, stateMetadata

public ingress
  validates connectionSeed.credential against manifest credentialPolicy
  validates providerConfigKey against the provider manifest/config profile
  upserts the parent account
  persists state metadata
  returns authorizationUrl
```

Junction must not reach around public ingress to write accounts. The parent account should be upserted before returning the Junction Link URL, normally as `status = "active"`, `setupPhase = "pending_link"`, and a bounded `setupExpiresAt`. Abandoned setup rows need cleanup/expiry behavior rather than permanent zombie accounts.

Use generic callback routes:

```txt
local daemon: /connect/:provider/callback
hosted web:  /api/device-sync/connect/[provider]/callback
```

Keep old OAuth callback routes as aliases for existing OAuth providers.

## Credential Contract

Use a credential union:

```ts
export type DeviceAccountCredential =
  | {
      kind: "oauth_tokens";
      tokens: ProviderAuthTokens;
    }
  | {
      kind: "provider_config";
      providerConfigKey: string;
      subject?: Record<string, string>;
    }
  | {
      kind: "none";
    };
```

Hosted runtime snapshots should use the same idea:

```ts
export type HostedDeviceConnectionCredentialSnapshot =
  | {
      kind: "oauth_tokens";
      tokenBundle: HostedRuntimeTokenBundle;
    }
  | {
      kind: "provider_config";
      providerConfigKey: string;
      credentialMetadata?: Record<string, unknown>;
    }
  | {
      kind: "none";
    };
```

Token clearing should be explicit and only valid for OAuth token credentials. `tokenBundle: null` must not mean both "missing token" and "clear tokens" after provider-config accounts exist.

Provider-config credentials cannot be exported or refreshed as token bundles. Tests must prove:

```txt
refreshTokens(provider_config account) -> unsupported credential error
exportTokenBundle(provider_config account) -> unsupported credential error
hosted token-bundle mutation on provider_config account -> rejected unless it is an explicit credential replacement
```

## Data Origin

Version `DeviceDataOrigin` now:

```ts
export interface DeviceDataOrigin {
  version: 1;
  aggregatorProvider?: string;
  sourceProviderSlug?: string;
  sourceType?: string;
  sourceInstanceId?: string | null; // opaque derived id only, never a raw upstream device/app/workout id
  observedAtRaw?: string;
  timeZoneOffsetMinutes?: number | null;
  timestampSemantics?: "utc" | "offset" | "floating" | "unknown";
  originConfidence?: "high" | "medium" | "low" | "unknown";
  normalizerVersion?: string;
}
```

For Junction-sourced records, keep `externalRef.system = "junction"` and put upstream attribution in `DeviceDataOrigin`. Use contract-safe resource types such as `junction-oura-sleep`, not colon-delimited values. Raw upstream source names, device ids, app ids, workout ids, or source identifiers may be read transiently to compute opaque hashes or resolve a provider/source, but they are not valid `DeviceDataOrigin` fields and must not be persisted in contracts, compact wearable source identity, source projection summaries, hosted settings payloads, or web-visible projections.

Compact wearable source identity must include origin identity so `Oura via Junction`, `Dexcom via Junction`, and `Withings via Junction` do not collapse into one source.

## Source Projection

Add a separate `device_connection_source` projection in PR 2 before Junction polling/importer work. It is not a replacement for per-record origin.

```txt
device_connection_source
  id
  connection_id
  source_instance_key
  source_provider_slug
  display_name
  status
  resource_availability_summary_json
  last_error_code
  last_error_message
  first_seen_at
  last_seen_at
  updated_at
```

Account metadata remains shallow/scalar. Source status, scope/resource availability, and UI source cards belong in the projection.

## Junction Config

Use explicit environment and region config:

```txt
JUNCTION_API_KEY
JUNCTION_CLIENT_USER_ID_SECRET
JUNCTION_ENV=sandbox | production
JUNCTION_REGION=us | eu
JUNCTION_PROVIDER_FILTER
JUNCTION_SUMMARY_RESOURCES
JUNCTION_TIMESERIES_RESOURCES
JUNCTION_SUMMARY_BACKFILL_DAYS
JUNCTION_TIMESERIES_BACKFILL_DAYS
JUNCTION_RESOURCE_OVERRIDES
JUNCTION_RECONCILE_DAYS
JUNCTION_RECONCILE_INTERVAL_MS
JUNCTION_REQUEST_TIMEOUT_MS
JUNCTION_WEBHOOK_SECRET
```

Validate environment, region, API-key prefix, and canonical base URL together:

```txt
production + us -> pk_us_* and api.us.junction.com
production + eu -> pk_eu_* and api.eu.junction.com
sandbox + us    -> sk_us_* and api.sandbox.us.junction.com
sandbox + eu    -> sk_eu_* and api.sandbox.eu.junction.com
```

Junction API requests use the canonical base URL for the selected environment and region. Tests and mocks should inject `fetchImpl` rather than configuring an alternate runtime host.


Keep these secrets separate because they have different lifetimes and blast radius:

```txt
Junction API key
client-user HMAC secret
webhook secret
```

## Junction Client

The client must be bounded:

```txt
- timeout every Junction request
- retry idempotent GETs with bounded exponential backoff
- respect 429 / Retry-After when present
- cap per-account resource fetch concurrency
- cap global Junction concurrency
- page until exhaustion where endpoints paginate
- emit metrics by resource/source/status code
```

Provider jobs should build bounded snapshots. Importers should normalize snapshots only.

## Provider Filter

Web Link MVP should include cloud providers only:

```txt
oura
fitbit
garmin
whoop
strava
withings
dexcom_v3
freestyle_libre
abbott_libreview
eight_sleep
renpho
```

Exclude SDK-only sources until there is a mobile ingestion slice:

```txt
apple_health_kit
health_connect
samsung_health
```

## Resource Windows

Use split defaults:

```ts
summaryBackfillDays: 90,
timeseriesBackfillDays: 14,
reconcileDays: 7,
resourceOverrides: {
  heartrate: { backfillDays: 7 },
  steps: { backfillDays: 14 },
  hrv: { backfillDays: 30 },
  weight: { backfillDays: 90 },
}
```

Default summaries:

```txt
profile
activity
sleep
workouts
body
```

Default timeseries:

```txt
steps
heartrate
hrv
respiratory_rate
blood_oxygen
weight
```

Do not default-enable every high-frequency or source-sensitive resource. Glucose is allowed only as an explicit opt-in Junction timeseries resource and must carry source/timestamp provenance; broader CGM policy, blood pressure, nutrition, ECG, body temperature deltas, stress, menstrual cycle, and workout streams remain later slices.

## Timestamp Interpretation

Make timestamp handling explicit:

```ts
type TimestampInterpretation =
  | {
      kind: "offset_bearing";
      observedAtRaw: string;
      observedAtUtc: string;
      timezoneOffsetSeconds?: number | null;
    }
  | {
      kind: "floating";
      observedAtRaw: string;
      observedAtUtc?: string;
      fallbackTimeZone?: string;
      reason: "junction_floating_time";
    }
  | {
      kind: "absent_timezone";
      observedAtRaw: string;
      observedAtUtc: string;
      timezoneOffsetSeconds: null;
    };
```

Libre/Freestyle-style floating timestamps must not be silently interpreted as UTC. If Murph converts local wall time to UTC, the chosen fallback timezone must be explicit in raw evidence/provenance.

## Webhooks

Polling/reconcile is authoritative. Webhooks are freshness/data triggers.

Do not rely on Junction retry for known-persistable unknown-account events:

```txt
valid signature + known account:
  persist trace
  enqueue job
  return 204

valid signature + unknown account:
  persist orphan trace keyed by hashed Junction user/client identity
  enqueue delayed bind/reconcile
  return 202 or 204

invalid signature:
  return 400 or 401
```

Only use provider retries when Murph cannot durably persist the event.

Historical completion events should enqueue bounded fetches. Do not import data-less notifications as data.

## Landing Slices

### PR 1: primitives

- `DeviceConnectionFlow`
- device-sync manifest `DeviceProviderCredentialPolicy`
- `DeviceAccountCredential`
- `credential_kind` storage locally and hosted
- hosted credential snapshot union
- `setupPhase` / `setupExpiresAt` storage and hydration
- ingress-owned `connectionSeed` persistence
- OAuth compatibility routes and adapters
- provider-config token export/refresh rejection
- raw owner/user/client identifier stripping from account, credential, state, and hosted runtime metadata
- hosted runtime credential replacement validation against manifest credential policy

### PR 2: provenance foundation

- versioned `DeviceDataOrigin`
- origin-aware `dataSourceId`
- source projection table/service
- typed timestamp interpretation contract and fixtures
- origin confidence and normalizer-version provenance
- tests proving multiple Junction upstream sources do not collapse into one canonical source

### PR 3: Junction polling MVP

- Junction descriptor/manifest/config
- env/region/key-prefix validation
- Junction REST client with bounded retry/pagination/concurrency
- HMAC `client_user_id`
- external-link begin/callback outcome
- parent account seed before redirect
- reconcile/resource jobs
- importer for default summaries/timeseries
- split summary/timeseries backfill windows

### PR 4: webhooks

- raw signature verification
- trace/dedupe
- orphan trace and delayed bind/reconcile
- event-to-job routing
- webhook health

### PR 5: source-aware query and richer resources

- direct-vs-Junction priority policy
- unsupported-source winning policy
- glucose/CGM and source-sensitive resources
- richer settings/source UI

## Parallelization

Wave 0 remains parent-owned: contract names, manifest credential policy, snapshot parser shape, setup phase contract, connection seed persistence, source projection contract, timestamp interpretation shape, and job hint field names.

After Wave 0 compiles, parallelize:

- local SQLite credential/source storage
- hosted Prisma credential/source storage
- hosted runtime snapshot and assistant-runtime hydration
- data-origin/canonical source fixtures

After descriptor/registry mini-gate, parallelize:

- Junction client/provider polling
- Junction importer
- routes and callback aliases
- fixture corpus

Webhooks start only after polling, parent account persistence, and source projection are proven.

## Current Implementation Status

PR 1, the PR 2 foundation, and the PR 3 polling MVP are committed as `509fce23b`. PR 4 Junction webhooks are committed as `08b71ada1`. PR 5 source-aware query/resource/UI work is committed as `384939154`. A final cross-plan/subagent hardening pass found and fixed the remaining PR 1-5 integration issues in this follow-up slice:

- OAuth/connect state now keeps owner identity on the typed state record instead of generic callback metadata, and provider-supplied callback metadata continues to strip raw owner/user/client identifiers.
- Existing disconnected seeded external-link accounts cannot be reactivated by stale callbacks; local and hosted connection upserts preserve existing lifecycle status when a callback omits `status`.
- Junction callback completion remains weak: it validates the Link outcome and seeded user identity, then enqueues polling without fetching source status on the browser return path.
- Junction webhook `resource` jobs use hosted wake-safe scalar payload fields that the hosted hint parser accepts.
- Unknown-account webhooks only complete without provider retries when a durable unknown/orphan hook exists; otherwise they release the trace and remain retryable.
- Junction resource webhook jobs skip opt-in resources such as glucose unless the resource is configured for that account/provider runtime.

Current PR 3 landed slice:

- Junction importer descriptor/adapter lane under `packages/importers/src/device-providers/{junction,provider-descriptors,defaults,index}.ts` plus focused importer tests.
- Junction device-syncd provider/client/config lane under `packages/device-syncd/src/providers/junction*.ts`, `packages/device-syncd/src/config/{provider-env,provider-types,provider-manifests}.ts`, plus focused provider/manifest tests.
- Provider manifest registers Junction with `provider_config` credential policy and lower source priority than direct providers.
- Junction config validates env/region/key-prefix/base-url consistency and keeps API key, HMAC client-user secret, and webhook secret as separate provider-owned values.
- `beginConnection` creates/resolves the Junction user with HMAC `client_user_id`, generates Link, and returns an ingress-persisted parent `connectionSeed` before redirect.
- `completeConnection` treats Link return as weak, uses the seeded external account as authority, rejects seeded/callback user-id mismatches, updates setup phase, and enqueues scalar polling jobs.
- Polling jobs reconcile Junction source projection rows, fetch bounded summary/timeseries windows from config, and import one Junction snapshot through the importer.
- Default resources remain conservative: profile/activity/sleep/workouts/body plus steps/heartrate/hrv/respiratory-rate/blood-oxygen/weight. Glucose stays opt-in and broader CGM expansion remains deferred.
- CLI provider validation now includes Junction in the supported provider list.

PR 4 landed slice:

- Junction descriptor now advertises `webhook_push` and `/webhooks/junction`.
- Junction config adds provider-owned `JUNCTION_WEBHOOK_SECRET` and optional timestamp tolerance, while keeping webhook secret out of serializable runtime config.
- Junction webhook parser verifies Svix `svix-id` / `svix-timestamp` / `svix-signature` against the raw body before parsing JSON.
- Junction webhook events map to scalar hosted-hint-safe jobs: connection events enqueue backfill/reconcile, data events enqueue `resource`, and unknown/control events enqueue reconcile.
- Junction `resource` jobs fetch only the hinted summary or timeseries resource/window and still refresh source projections before importing the snapshot.
- Generic public ingress can complete verified unknown-account webhooks for providers that opt in, so Junction can avoid provider retries when the pre-Link parent is briefly not visible; hosted route returns `202` for that orphaned acceptance.
- Webhooks remain freshness/fetch triggers only; no inline webhook normalization was added.

PR 4 intentionally excluded source-aware query policy, SDK-only Link sources, glucose/CGM, and richer source settings UI. PR 5 now covers the source-aware query/resource/UI slice while still excluding SDK-only Link sources and broader CGM expansion.

PR 5 implemented slice:

- Contract-level `DeviceDataOrigin` is persisted on event and sample ledger records, generated schemas, core device import inputs, and query candidate construction.
- Query candidate IDs and exact-dedupe keys include upstream origin identity when present, while preserving legacy keys for records without origin.
- Junction data-origin fallback can infer upstream source from contract-safe Junction `externalRef.resourceType` values such as `junction-oura-activity` for older records that do not yet carry `dataOrigin`.
- Query ranking adds source-aware Junction policy: direct provider records beat matching Junction-sourced duplicates when that direct provider exists, while unsupported upstream sources through Junction receive a bounded positive adjustment instead of being permanently treated as low-priority generic Junction data.
- Canonical wearable records pass origin into semantic query candidates so canonical snapshots and ledger-derived records use the same source policy.
- Junction timeseries `weight` is normalized as a body observation instead of an invalid sample stream.
- Junction timeseries `glucose` is supported as an opt-in resource, not a default, and preserves timestamp semantics/source provenance for CGM-style data.
- Hosted settings responses now include sanitized upstream source summaries keyed by browser-safe connection ids, and the settings card displays upstream source labels/status/resource counts without exposing raw source instance keys or account identifiers.

The landed primitive/foundation slice includes:

- `external_link` descriptor support and generic local/hosted callback routes, with OAuth callback routes kept as aliases.
- `DeviceAccountCredential` and hosted credential snapshot unions for `oauth_tokens`, `provider_config`, and `none`.
- Local SQLite and hosted Prisma credential/setup storage using additive schema changes.
- Ingress-owned `connectionSeed` persistence before redirect, with `setupPhase` / `setupExpiresAt` rather than `status = "connecting"`.
- Seeded external-link callback/setup failures mark the pre-created parent account as `setupPhase = "failed"` / `status = "reauthorization_required"` instead of leaving active pending setup rows indefinitely.
- Public provider descriptors can represent callback-less `sdk`, `manual`, and `none` flows with null callback fields, while `oauth2` and `external_link` connection starts still fail explicitly if no callback URL is configured.
- Provider catalog entries now resolve the generic connection descriptor instead of reading OAuth-only descriptor fields.
- Device-sync manifest credential policy validation, including provider-config profile-key checks.
- Built-in manifest credential policy takes precedence over provider instance overrides.
- External-link callbacks must resolve to the seeded parent account; mismatches fail the seeded setup instead of creating a second account row.
- Pending external-link setup expiry is preserved on callback until the provider explicitly clears it or confirms the source.
- Callback results that include both new credential material and legacy OAuth tokens are rejected as ambiguous.
- Fail-closed provider-config behavior for token refresh/export and hosted token-bundle mutation paths.
- Metadata sanitization that strips raw owner/user/client ids and provider secrets while preserving explicit hash/blind-index fields, including provider-supplied callback state metadata.
- Hosted credential-row validation and Prisma `CHECK` constraints for credential kind, setup phase, and token-material/provider-config consistency.
- Settings-source rendering that shows `pending_link` / `link_returned` setup as still setting up, and expired or failed setup as reconnectable, without changing account lifecycle status.
- Hosted local-heartbeat store fixtures use explicit `oauth_tokens` credential rows so the new fail-closed credential mapper is covered by existing heartbeat tests.
- `DeviceDataOrigin` provenance fields for upstream source identity, timestamp semantics, origin confidence, and normalizer version.
- Origin-aware compact wearable data-source identity, with tests proving two Junction upstream source slugs under one aggregator account do not collapse.
- Local SQLite `device_connection_source` projection storage keyed by parent connection plus opaque source instance key, with deterministic listing and cascade-delete coverage.
- Hosted Prisma `DeviceConnectionSource` / additive `2026050101_device_connection_sources` migration, aligned status vocabulary, deterministic listing, and same-provider multi-source coverage.
- Source projection sanitation keeps account metadata shallow and strips raw identifier-shaped availability/source values from projection summaries.

PR 5 required security/privacy, coverage, simplification, task-finish, and frontend review passes were run before commit. The final cross-plan review added the hardening fixes above without changing the core architecture.

Latest PR 5 focused verification:

```txt
pnpm --dir packages/contracts generate
pnpm --dir packages/contracts typecheck
pnpm --dir packages/contracts test
pnpm --dir packages/core typecheck
pnpm --dir packages/core test -- device-import.test.ts import-device-batch-validation.test.ts
pnpm --dir packages/importers typecheck
pnpm --dir packages/importers test -- device-providers-junction.test.ts
pnpm --dir packages/device-syncd typecheck
pnpm --dir packages/device-syncd test -- junction-provider.test.ts provider-manifests.test.ts
pnpm --dir packages/query typecheck
pnpm --dir packages/query test -- query.test.ts wearables-selection-shared-final.test.ts wearables-candidates-final.test.ts wearables-coverage-branches.test.ts
pnpm --dir apps/web typecheck
pnpm exec vitest run apps/web/test/device-sync-settings-surface.test.ts apps/web/test/device-sync-hosted-wake.test.ts apps/web/test/dashboard-sidebar.test.ts --config apps/web/vitest.config.ts --no-coverage
```

Final cross-plan hardening verification:

```txt
pnpm --dir packages/device-syncd test -- public-ingress.test.ts hosted-runtime.test.ts junction-provider.test.ts
pnpm --dir packages/device-syncd test:coverage
pnpm exec vitest run apps/web/test/prisma-store-oauth-connection.test.ts --config apps/web/vitest.config.ts --no-coverage
pnpm --dir packages/device-syncd typecheck
pnpm --dir apps/web typecheck
pnpm --dir apps/web lint
```

Known broader hosted-web test command in the current dirty checkout:

```txt
pnpm --dir apps/web test
```

The hosted-web lint lane now passes with four unrelated warnings in existing biomarker, protocol-tab, and join-invite files outside this slice. The broader hosted-web test failure from the PR 5 wave was 24 unrelated UI/content/migration expectation failures; the local-heartbeat credential failures found during that wave were fixed.

## Verification

Minimum primitive checks:

```txt
pnpm typecheck
pnpm test:diff packages/importers/src/device-providers/provider-descriptors.ts packages/device-syncd/src/types.ts packages/device-syncd/src/public-ingress.ts packages/device-syncd/src/store/schema.ts packages/device-syncd/src/hosted-runtime.ts apps/web/prisma/schema.prisma packages/assistant-runtime/src/hosted-device-sync-runtime.ts
pnpm --dir packages/device-syncd test:coverage
pnpm --dir packages/assistant-runtime test:coverage
pnpm --dir apps/web verify
```

Minimum Junction polling checks:

```txt
pnpm typecheck
pnpm test:diff packages/device-syncd/src/providers/junction.ts packages/device-syncd/src/providers/junction-client.ts packages/importers/src/device-providers/junction.ts
pnpm --dir packages/device-syncd test:coverage
pnpm --dir packages/importers test:coverage
```

Required review passes for implementation:

- security/privacy review
- coverage-write
- task-finish-review
- frontend-review only when user-facing settings UI changes

## Do Not Do

- Do not add `junction_oura`, `junction_garmin`, or other pseudo-providers.
- Do not fake OAuth or fake empty token bundles.
- Do not store Junction API keys, webhook secrets, HMAC secrets, raw owner ids, or raw client user ids in account rows.
- Do not put source arrays or resource availability maps into account metadata.
- Do not set `externalRef.system` to an upstream provider for Junction-sourced data.
- Do not import webhooks inline before polling/reconcile exists.
- Do not include SDK-only sources in the web-Link MVP.
- Do not silently treat floating timestamps as UTC.
