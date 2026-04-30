# Junction greenfield primitive update

Status: completed
Created: 2026-04-30
Updated: 2026-04-30

## Purpose

This is the canonical Junction implementation plan. It replaces the earlier Junction device-sync and parallelization drafts. The user-supplied RTF plan and follow-up review found the higher-value primitive: do not bolt `hosted_link` onto the current OAuth-shaped provider interface. Instead, split device sync into three separate concepts:

```txt
connection flow       how the user connects
account credential    how Murph authenticates later API calls
data origin           where the imported wearable record really came from
```

For Junction:

```txt
provider              junction
connection flow       external_link
account credential    provider_config
external account id   Junction user_id
data origin           upstream Junction source/device/app
```

## Verdict

Adopt the RTF plan's greenfield primitive with the fixes below. The most important change is naming and modeling: the generic runtime concept is `external_link`, not `hosted_link`, and the account credential is a typed `provider_config` credential, not an empty or fake token bundle.

This makes Junction a normal provider in Murph's registry while avoiding three bad shortcuts:

- no fake OAuth `code` path for Junction Link
- no per-user storage of the Junction team API key
- no `junction_oura`, `junction_garmin`, or other pseudo-providers

## Current repo facts

The current code is still OAuth-shaped:

- `DeviceProviderTransportMode` has `oauth_callback`, scheduled, webhook, async, SDK, and XML modes, but no `external_link`.
- Provider descriptors expose `oauth?: DeviceProviderOAuthDescriptor`, but no generic `connection` descriptor.
- `DeviceSyncProvider` requires `buildConnectUrl`, `exchangeAuthorizationCode`, and `refreshTokens`.
- `ProviderConnectionResult` and `UpsertPublicDeviceSyncConnectionInput` require `tokens`.
- Local SQLite requires `device_credential_state.access_token_encrypted`.
- Hosted runtime snapshots use `tokenBundle: ... | null`, where `null` already has token-clear semantics.
- Hosted runtime status parsing accepts only `active`, `reauthorization_required`, and `disconnected`.
- Account metadata is scalar-only; it is not a home for connected-source arrays or resource availability maps.
- Canonical wearable source identity currently hashes provider, connection id, and provider account hash. That would collapse all Junction upstream sources into one source.
- Query candidate provider identity is derived from `externalRef.system`, so a Junction record with `system = "junction"` will be ranked as Junction until source-aware query policy exists.

## Updated Primitive 1: DeviceConnectionFlow

Add a provider-level connection descriptor:

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
```

Change the shared descriptor shape to prefer `connection`:

```ts
export interface DeviceProviderDescriptor {
  provider: string;
  displayName: string;
  transportModes: readonly DeviceProviderTransportMode[];
  connection?: DeviceProviderConnectionDescriptor;
  oauth?: DeviceProviderOAuthDescriptor; // temporary compatibility alias
  webhook?: DeviceProviderWebhookDescriptor;
  sync?: DeviceProviderSyncDescriptor;
  normalization: DeviceProviderNormalizationDescriptor;
  sourcePriorityHints: DeviceProviderSourcePriorityHints;
}
```

Add the transport mode:

```ts
export type DeviceProviderTransportMode =
  | "oauth_callback"
  | "external_link"
  | "scheduled_poll"
  | "webhook_push"
  | "async_export"
  | "sdk_ingestion"
  | "xml_import";
```

Use `external_link` instead of `hosted_link`. The provider owns the user-facing linking flow; the flow can run from hosted web, local daemon, CLI, or a future mobile handoff. "Hosted" is a deployment detail, not the connection primitive.

Existing providers should get:

```ts
connection: {
  kind: "oauth2",
  callbackPath: "/oauth/oura/callback",
  defaultScopes: [...],
}
```

Junction should get:

```ts
connection: {
  kind: "external_link",
  callbackPath: "/connect/junction/callback",
}
```

Keep old OAuth callback routes as compatibility aliases. New generic routes should be:

```txt
local daemon: /connect/:provider/callback
hosted web:  /api/device-sync/connect/[provider]/callback
```

The public ingress should expose generic names while keeping OAuth aliases for compatibility:

```ts
startConnection(input: StartConnectionInput): Promise<BeginConnectionResult>;
handleConnectionCallback(input: HandleConnectionCallbackInput): Promise<CompleteConnectionResult>;
handleOAuthCallback(input: HandleOAuthCallbackInput): Promise<CompleteConnectionResult>; // alias
```

Providers can implement the new handler directly or use an OAuth adapter:

```ts
export interface DeviceConnectionHandler {
  beginConnection(input: ProviderBeginConnectionContext): Promise<ProviderBeginConnectionResult>;
  completeConnection(input: ProviderCompleteConnectionContext): Promise<ProviderConnectionResult>;
}

export interface ProviderBeginConnectionResult {
  authorizationUrl: string;
  connectionSeed?: ProviderConnectionSeed;
  stateMetadata?: Record<string, unknown>;
  scopes?: string[];
}
```

The `connectionSeed` path is important for Junction because the parent account must exist before redirecting to Link.

## Updated Primitive 2: DeviceAccountCredential

Replace mandatory token results with a credential union:

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

export interface ProviderConnectionResult {
  externalAccountId: string;
  displayName?: string | null;
  scopes?: string[];
  metadata?: Record<string, unknown>;
  credential: DeviceAccountCredential;
  initialJobs?: DeviceSyncJobInput[];
  nextReconcileAt?: string | null;
}
```

Existing OAuth providers return:

```ts
credential: {
  kind: "oauth_tokens",
  tokens,
}
```

Junction returns:

```ts
credential: {
  kind: "provider_config",
  providerConfigKey: "junction",
  subject: {
    clientUserIdHash,
  },
}
```

Do not duplicate Junction `user_id` in generic credential metadata unless a concrete boundary requires it; the account's `externalAccountId` is already the Junction user id. Do not use `secretRef: "env:JUNCTION_API_KEY"` as account data. The team API key, HMAC secret, and webhook secret stay in trusted provider config. Account state may reference `providerConfigKey: "junction"` and store only non-secret subject identifiers needed to execute provider work.

This credential union must reach every runtime surface, not only connection callback code:

- public account upsert
- local SQLite account storage
- hosted Prisma storage
- provider job context
- scheduled job creation
- token refresh
- token export
- disconnect/revoke
- hosted runtime snapshot response
- hosted runtime apply request
- assistant-runtime hosted device-sync hydration

Token export and refresh must fail closed for `provider_config` and `none` accounts with a clear non-exportable or unsupported error.

## Updated Primitive 3: DeviceDataOrigin

Junction is an aggregator. One Murph account can import Oura, Garmin, Dexcom, Libre, Withings, phone, watch, ring, app, and manual data. The provider account and the data origin are different identities.

Add a typed origin shape in the importer/core/canonical wearable source path:

```ts
export interface DeviceDataOrigin {
  aggregatorProvider?: string;     // "junction"
  sourceProviderSlug?: string;     // "oura", "garmin", "dexcom_v3", ...
  sourceName?: string;
  sourceType?: string;             // watch, phone, ring, cgm, app, manual, ...
  sourceDeviceId?: string | null;
  sourceAppId?: string | null;
  sourceWorkoutId?: string | null;
}
```

For Junction-sourced Oura data, do not set `externalRef.system = "oura"`. Use:

```ts
externalRef: {
  system: "junction",
  resourceType: "oura-sleep",
  resourceId,
  version,
  facet,
}
```

Use contract-safe `resourceType` slugs with hyphens, not colon-delimited strings, because current external-ref parsing and downstream resource scoring assume slug-like values. Exact upstream slug, device id, app id, and source type belong in `DeviceDataOrigin` and raw provenance.

Update canonical wearable source identity so Junction sources do not collapse:

```txt
dataSourceId = hashStable([
  provider,
  connectionId,
  providerAccountIdHash,
  origin.sourceProviderSlug,
  origin.sourceType,
  origin.sourceDeviceId,
  origin.sourceAppId,
]);
```

Hash or omit device/app identifiers before exposing source projections to web-visible surfaces. Keep raw origin evidence in raw artifacts and provenance, not in account metadata.

## Source Projection Is Separate From Data Origin

Add a compact source projection table in the Junction connect/polling slice. This is not the same as per-record `DeviceDataOrigin`.

Projection purpose:

- connection/source status
- webhook routing
- settings display
- future source-aware query policy

Origin purpose:

- per-record provenance
- canonical source identity
- duplicate handling
- query attribution

Projection storage:

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

Key by parent connection plus a stable source instance key. Source slug alone is too weak when an aggregator can represent multiple devices, apps, or accounts from the same upstream source. If Junction does not provide stable source instance ids for a resource, derive a privacy-bounded key from available non-secret source fields.

Do not put `connectedSources: []` or `resourceAvailability: {}` into account metadata. The metadata sanitizer is intentionally shallow and scalar-only.

## Connection Flow

Junction Link requires a Junction user and Link token. It does not return provider OAuth tokens to Murph.

### beginConnection

```txt
1. Validate owner identity for the current runtime.
2. Compute HMAC client_user_id:
   "murph_" + base64url(hmacSha256(JUNCTION_CLIENT_USER_ID_SECRET, ownerId)).slice(0, 32)
3. Create or resolve the Junction user.
4. Upsert the parent Murph account before redirect:
   provider = "junction"
   externalAccountId = junctionUserId
   status = "connecting"
   credential.kind = "provider_config"
   providerConfigKey = "junction"
5. Persist connection state metadata:
   connection id
   Junction user id
   client-user-id hash, not raw owner id
   provider filter version
6. Generate Junction Link token with redirect_url carrying murph_state.
7. Return link_web_url.
```

Parent persistence before redirect is required because webhooks can arrive before the browser returns from Link.

Use `murph_state`, not a bare `state` query parameter, so Murph's CSRF state does not collide with Junction callback fields.

### completeConnection

```txt
1. Consume generic Murph connection state.
2. Classify the Link return as success, cancelled, error, or unknown.
3. Persist only scalar outcome metadata.
4. Enqueue reconcile.
5. Redirect back to settings or the local callback page.
```

The callback is weak. Reconcile is authoritative. Source status should come from Junction connected-provider/resource APIs and webhooks, not from trusting browser-return semantics.

## Storage And Runtime Contract

### Local SQLite

Update `device_credential_state` toward:

```sql
device_credential_state (
  account_id text primary key references device_connection(id) on delete cascade,
  credential_kind text not null,
  provider_config_key text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  access_token_expires_at text,
  credential_metadata_json text not null default '{}',
  token_revision integer not null default 0,
  token_version integer,
  key_version integer,
  updated_at text not null
);
```

Validation:

```txt
oauth_tokens    -> access_token_encrypted required
provider_config -> access_token_encrypted null
none            -> access_token_encrypted null
```

Backfill existing rows as `credential_kind = "oauth_tokens"`.

### Hosted Prisma

Hosted token columns are already nullable, but the app still assumes token bundles during upsert/hydration. Add a discriminator and provider-config metadata:

```txt
credentialKind
providerConfigKey
credentialMetadataJson
```

Keep credential metadata small and non-secret. Do not duplicate Junction API keys, webhook secrets, HMAC secrets, or raw owner ids there.

### Hosted Runtime Snapshots

Replace ambiguous `tokenBundle: null` with a credential snapshot union:

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

Token clearing should be an explicit mutation, not inferred from `tokenBundle: null`. Otherwise a provider-config Junction snapshot can be mistaken for a request to erase tokens.

Add `connecting` to hosted/local account status parsing or create an equivalent explicit pending-link state. Check these surfaces for blast radius:

- device-syncd hosted runtime parser
- assistant-runtime hosted device-sync hydration
- settings display
- webhook acceptance
- wake/signal code that filters by account status

## Junction Provider Descriptor

Register one provider:

```ts
export const JUNCTION_DEVICE_PROVIDER_DESCRIPTOR = {
  provider: "junction",
  displayName: "Junction",
  transportModes: ["external_link", "scheduled_poll", "webhook_push"],
  connection: {
    kind: "external_link",
    callbackPath: "/connect/junction/callback",
  },
  webhook: {
    path: "/webhooks/junction",
    deliveryMode: "resource",
    supportsAdmin: false,
  },
  sync: {
    windows: {
      backfillDays: 90,
      reconcileDays: 7,
      reconcileIntervalMs: 6 * 60 * 60_000,
    },
    jobKinds: ["backfill", "reconcile", "resource"],
    supportsRemoteDisconnect: true,
    supportsTokenRefresh: false,
  },
  normalization: {
    metricFamilies: [
      "activity",
      "sleep",
      "recovery",
      "readiness",
      "cardio",
      "respiration",
      "blood_oxygen",
      "body",
      "session",
    ],
    snapshotParser: "schema",
  },
  sourcePriorityHints: {
    defaultPriority: 60,
    metricFamilies: {
      activity: 65,
      sleep: 65,
      recovery: 60,
      readiness: 60,
      cardio: 65,
      respiration: 65,
      blood_oxygen: 65,
      body: 65,
      session: 65,
    },
  },
} as const satisfies DeviceProviderDescriptor;
```

Keep lower provider-level priority in v1 because Murph already has direct providers for Oura, Garmin, WHOOP, and Strava. Junction should become source-aware later, not by lying about `externalRef.system`.

## Junction Config

Provider config:

```ts
export interface JunctionDeviceSyncProviderConfig {
  apiKey: string;
  clientUserIdSecret: string;
  baseUrl?: string;
  providerFilter?: string[];
  summaryResources?: JunctionSummaryResource[];
  timeseriesResources?: JunctionTimeseriesResource[];
  backfillDays?: number;
  reconcileDays?: number;
  reconcileIntervalMs?: number;
  requestTimeoutMs?: number;
  webhookSecret?: string;
  fetchImpl?: typeof fetch;
}
```

Env:

```txt
JUNCTION_API_KEY
JUNCTION_CLIENT_USER_ID_SECRET
JUNCTION_BASE_URL
JUNCTION_PROVIDER_FILTER
JUNCTION_SUMMARY_RESOURCES
JUNCTION_TIMESERIES_RESOURCES
JUNCTION_BACKFILL_DAYS
JUNCTION_RECONCILE_DAYS
JUNCTION_RECONCILE_INTERVAL_MS
JUNCTION_REQUEST_TIMEOUT_MS
JUNCTION_WEBHOOK_SECRET
```

Serializable hosted/local config may include base URL, provider filter, resource lists, windows, and timeouts. It must not include API keys, HMAC secrets, webhook secrets, authorization headers, or `fetchImpl`.

Default web-Link provider filter should exclude SDK-only mobile sources until a mobile ingestion slice exists:

```txt
include:
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

exclude from web-Link MVP:
  apple_health_kit
  health_connect
  samsung_health
```

## Resource Defaults

Start narrower than the broad RTF default because Junction timeseries volume can grow quickly and some timestamp semantics are source-specific.

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

Keep these configurable but not default-enabled in the first polling PR:

```txt
calories_active
distance
body_temperature
glucose
nutrition
blood_pressure
stress
workout streams
menstrual cycle
ECG
```

Glucose/CGM should be a deliberate second slice with explicit timestamp and source tests. Libre-style floating time must not be silently interpreted as UTC.

## Importer Contract

Snapshot input should be schema-first, raw-preserving, and origin-aware:

```ts
export interface JunctionSnapshotInput {
  accountId: string;
  importedAt: string;
  windowStart?: string;
  windowEnd?: string;
  user?: unknown;
  connections?: unknown[];
  resourceAvailability?: unknown[];
  summaries?: Partial<Record<JunctionSummaryResource, unknown[]>>;
  timeseries?: Partial<Record<JunctionTimeseriesResource, unknown[]>>;
  webhook?: {
    eventType?: string;
    traceId?: string;
    sourceProviderSlug?: string;
    resource?: string;
    resourceCategory?: string;
    objectId?: string;
    occurredAt?: string;
  };
}
```

Do not include raw `clientUserId` or raw owner ids in snapshots. If a correlation value is necessary, use a redacted hash.

Recommended v1 mappings:

| Junction resource | Murph mapping |
| --- | --- |
| `profile` | raw artifact plus provenance only |
| `activity` | daily observations such as steps, distance, active calories where canonical metrics exist |
| `sleep` | `sleep_session` plus sleep observations |
| `workouts` | `activity_session` plus bounded observations |
| `body` | body observations such as weight, BMI, body fat, SpO2 where supported |
| `heartrate` | heart-rate samples |
| `hrv` | HRV samples |
| `respiratory_rate` | respiratory-rate samples |
| `blood_oxygen` | SpO2 samples or observations |
| `steps` | step samples |
| `weight` | weight samples or observations |

Timestamp policy:

- Preserve `observedAtRaw`.
- Preserve provider/source time-zone fields.
- Normalize UTC timestamps only when the source timestamp is actually offset-bearing.
- Mark source-specific floating timestamps as floating/user-fallback/absent until canonical time-zone handling exists.
- Add fixtures for normal UTC, explicit offset, absent offset, and Libre-style floating timestamp behavior.

## Webhooks And Jobs

Polling comes first. Webhooks are freshness/data triggers, not the initial source of truth.

Use three job kinds:

```ts
type JunctionJobKind = "backfill" | "reconcile" | "resource";
```

Use `sourceProviderSlug`, not `providerSlug`, in Junction job payloads to avoid ambiguity with the Murph provider `junction`.

Keep hosted hint payloads scalar. Current hosted hint parsing rejects unknown fields and is not a good place for configured resource arrays. Arrays should live in provider config or local job payloads, not hosted wake hints.

Required hint/parser tests:

- `shapeConfiguredDeviceSyncHostedHintPayload()` keeps only supported scalar hints.
- `normalizeHostedDeviceSyncJobHints()` accepts Junction resource hints that are intentionally supported.
- Unknown Junction-specific fields are either explicitly added to the allowlist or intentionally excluded with tests.

Webhook handling:

```txt
provider.connection.created
  update source projection if present
  mark parent active
  enqueue reconcile/backfill

historical.data.*.created
  enqueue bounded resource fetch
  do not import the notification as data

daily.data.*.created|updated
  import inline only if payload is complete and bounded
  otherwise enqueue resource fetch

message.attempt.exhausted
  mark webhook health issue
  enqueue reconcile when account is known
```

Unknown-account webhooks should be retryable because Link-created webhooks can beat browser callback completion.

Verify Svix-style signatures over the raw body before trusting parsed payload fields. Prefer built-in crypto if the implementation stays small. If an SDK is added, the worker must own the lockfile update and dependency rationale.

## Query Priority

V1:

- rank Junction below direct Oura/Garmin/WHOOP/Strava at the provider level
- keep imported records as `externalRef.system = "junction"`
- preserve source origin so later query policy can distinguish `Oura via Junction` from `Dexcom via Junction`

Follow-up after importer provenance fixtures:

- teach query candidates to extract `origin.sourceProviderSlug` from canonical source/provenance for Junction records
- rank direct providers above Junction for the same direct-supported upstream source
- let Junction win for sources Murph does not support directly
- add duplicate tests for direct Oura plus Junction-sourced Oura
- add unsupported-source tests where Junction is the best source

Do not add descriptor `sourceOverrides` until query can consume them.

## Parallelization Update

### Wave 0: parent-owned contract gate

Serialize the contract names and parser shape before workers start:

```txt
DeviceConnectionFlow
DeviceAccountCredential
DeviceDataOrigin
HostedDeviceConnectionCredentialSnapshot
connecting account status
connectionSeed or begin-connection parent persistence contract
source projection table contract
Junction job hint field names
```

This wave is too central to delegate as a long-running worker.

### Wave 1: foundation workers

Safe to parallelize after Wave 0:

- device-sync ingress and OAuth compatibility
- local SQLite credential/source storage
- hosted Prisma credential/source storage
- assistant-runtime hosted device-sync hydration after the snapshot union is stable

Do not let multiple workers edit the same migration, schema-version bump, or hosted runtime parser.

### Wave 1.5: descriptor and registry mini-gate

One owner should update provider descriptors, provider defaults, registry exports, and manifest catalog typing. Both the Junction provider worker and importer worker will need those files, so the descriptor/registry gate must land before they split.

### Wave 2: Junction polling MVP

Safe to parallelize after foundation contracts compile:

- Junction REST client and provider begin/reconcile/resource jobs
- Junction importer and fixtures
- hosted/local external-link routes
- optional separate fixture-corpus worker if fixtures become large

The provider worker owns `sourceProviderSlug` job payload naming. The importer worker owns `DeviceDataOrigin` normalization fixtures.

### Wave 3: webhooks, settings, docs

Start only after polling, source projection, and reconcile work:

- Junction webhooks
- settings/source-state UI
- durable docs and compatibility matrix

Webhooks must not be implemented before parent account persistence and polling reconcile are proven.

### Wave 4: source-aware query

Optional follow-up after imported origin fixtures exist. Do not block the first polling MVP unless product behavior requires source-specific duplicate resolution immediately.

## Implementation Slices

### PR 1: generic primitive, no Junction data

Land:

- `connection.kind` descriptor plus OAuth compatibility alias
- `external_link` transport mode
- generic `beginConnection` and `completeConnection` hooks
- `DeviceAccountCredential`
- credential-kind storage locally and hosted
- hosted credential snapshot union
- provider-config token export/refresh rejection
- `connecting` or equivalent pending-link state

Existing OAuth providers must remain green.

### PR 2: data-origin and source projection foundation

Land:

- `DeviceDataOrigin` in importer/core/canonical source path
- origin-aware `dataSourceId`
- compact source projection storage locally and hosted
- source projection service helpers
- tests proving multiple Junction upstream sources do not collapse into one canonical source

This can land before the Junction provider if the origin shape is stable.

### PR 3: Junction connect plus polling

Land:

- Junction provider descriptor and manifest
- Junction config/env parsing
- Junction REST client
- HMAC `client_user_id`
- parent account upsert before Link redirect
- callback outcome recording
- reconcile and bounded resource fetch jobs
- Junction importer for default resources
- timestamp fixtures

Skip webhooks in this PR unless polling is already proven and the diff remains small.

### PR 4: Junction webhooks

Land:

- raw-body signature verification
- trace/dedupe
- event-to-job routing
- unknown-account retry behavior
- webhook health metadata

### PR 5: source-aware query and richer resources

Land only after v1 ingestion is stable:

- direct-vs-Junction duplicate policy
- unsupported-source winning policy
- glucose/CGM and other high-risk resources
- source-level settings refinements

## Files To Recheck Before Implementation

Generic primitives:

```txt
packages/importers/src/device-providers/provider-descriptors.ts
packages/device-syncd/src/types.ts
packages/device-syncd/src/client.ts
packages/device-syncd/src/public-ingress.ts
packages/device-syncd/src/http.ts
packages/device-syncd/src/service.ts
packages/device-syncd/src/store/schema.ts
packages/device-syncd/src/store/accounts.ts
packages/device-syncd/src/store/hosted-account-hydration.ts
packages/device-syncd/src/hosted-runtime.ts
apps/web/prisma/schema.prisma
apps/web/src/lib/device-sync/prisma-store/connections.ts
apps/web/src/lib/device-sync/agent-session-service.ts
packages/assistant-runtime/src/hosted-device-sync-runtime.ts
```

Junction provider:

```txt
packages/device-syncd/src/providers/junction.ts
packages/device-syncd/src/providers/junction-client.ts
packages/device-syncd/src/config/provider-env.ts
packages/device-syncd/src/config/provider-types.ts
packages/device-syncd/src/config/provider-manifests.ts
packages/device-syncd/src/config/serializable-provider-configs.ts
packages/device-syncd/src/config/provider-factory.ts
packages/device-syncd/src/index.ts
```

Junction importer and query:

```txt
packages/importers/src/device-providers/junction.ts
packages/importers/src/device-providers/canonical-wearable-records.ts
packages/importers/src/device-providers/defaults.ts
packages/importers/src/device-providers/index.ts
packages/query/src/wearables/candidates.ts
packages/query/src/wearables/provider-policy.ts
packages/query/src/wearables/types.ts
```

Hosted/local routes:

```txt
apps/web/app/api/device-sync/connect/[provider]/callback/route.ts
apps/web/app/api/device-sync/oauth/[provider]/callback/route.ts
apps/web/app/api/settings/device-sync/providers/[provider]/connect/route.ts
apps/web/app/api/internal/device-sync/providers/[provider]/connect-link/route.ts
packages/device-syncd/src/http.ts
```

Avoid stale paths from the RTF plan:

- use `apps/web/app/...`, not `apps/web/src/app/...`
- verify any CLI setup paths before assigning them; the current setup package is under `packages/setup-cli`

## Verification Additions

Minimum generic primitive checks:

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

Minimum webhook checks:

```txt
pnpm typecheck
pnpm test:diff packages/device-syncd/src/providers/junction.ts apps/web/app/api/device-sync/webhooks/[provider]/route.ts
pnpm --dir packages/device-syncd test:coverage
pnpm --dir apps/web verify
```

Final high-risk merge, if the checkout is not already red for unrelated reasons:

```txt
pnpm verify:acceptance
```

Required implementation review passes:

- security/privacy review for auth material, secrets, health data, external routes, webhooks, runtime snapshots, token export, and account identifiers
- coverage-write for generic primitives, provider-config auth, importer, webhooks, and source projection
- frontend-review for user-facing settings changes
- task-finish-review before implementation handoff
- simplify review when a code diff grows large or introduces new cross-package abstractions

## Fixes To The Previous Plans

Replace these earlier plan choices:

- `hosted_link` -> `external_link`
- `ProviderAuthMaterial` or `account_tokens` -> `DeviceAccountCredential` with `oauth_tokens`, `provider_config`, and `none`
- `secretRef = "env:JUNCTION_API_KEY"` in account auth -> `providerConfigKey = "junction"` plus provider-owned secret config
- `tokenBundle: null` for provider-config snapshots -> explicit hosted credential snapshot union
- raw `clientUserId = "murph:<owner-id>"` -> HMAC-derived `client_user_id`
- source arrays in account metadata -> compact source projection table
- `providerSlug` in Junction job payloads -> `sourceProviderSlug`
- colon-delimited `externalRef.resourceType` examples -> contract-safe slug values such as `oura-sleep`
- broad default timeseries -> conservative default resource set
- callback-as-authority -> callback records outcome, reconcile is authority
- source-aware query in v1 -> preserve origin in v1, add source-aware query after fixtures

## Do Not Do

- Do not register downstream Junction sources as Murph providers.
- Do not force Junction through OAuth code exchange.
- Do not store the Junction API key per account.
- Do not serialize HMAC secrets, webhook secrets, API keys, or authorization headers into hosted runtime config.
- Do not use upstream provider slugs as `externalRef.system` for Junction data.
- Do not normalize webhooks inline before polling/reconcile exists.
- Do not default-enable every timeseries.
- Do not silently treat Libre-style floating timestamps as UTC.
- Do not broaden into Apple HealthKit, Health Connect, or Samsung Health web-Link support before a mobile SDK slice exists.

## Final Target Shape

```ts
DeviceProvider
  descriptor
    connection: oauth2 | external_link | sdk | manual | none
    credentialPolicy: oauth_tokens | provider_config | none
    webhook
    sync
    normalization

  connectionHandler
    beginConnection()
    completeConnection()

  webhookHandler
  jobExecutor
  importerAdapter
```

Junction is then:

```txt
provider = "junction"
connection.kind = "external_link"
credential.kind = "provider_config"
providerConfigKey = "junction"
externalAccountId = Junction user_id
sync = scheduled_poll + webhook_push
normalization = schema snapshot adapter
dataOrigin = upstream Junction source/device/app
```

That gives Murph a durable primitive for Junction and for future non-OAuth device integrations without creating Junction-specific runtime hacks.
Completed: 2026-04-30
