# Add Junction device-sync provider

Status: completed
Created: 2026-04-30
Updated: 2026-04-30

## Goal

Add Junction as one first-class Murph device-sync provider, with Junction's downstream device providers preserved as source provenance inside imported snapshots rather than registered as separate Murph providers.

The finished integration should let a user start a Junction Link connection from hosted settings or the local device-sync control plane, store a durable Murph `junction` parent account keyed by Junction `user_id`, poll configured Junction resources into the existing importer/core path, and later accept Junction webhooks as freshness and resource-fetch triggers.

## Success criteria

- `junction` appears as one provider in the shared descriptor/manifest registry.
- Existing OAuth providers still connect through the current OAuth path.
- Junction Link uses a generic `hosted_link` connection mode instead of fake OAuth codes.
- Junction accounts use provider-config/team-key auth, not per-user OAuth token storage.
- `client_user_id` is deterministic, non-PII, and HMAC-derived from the Murph owner id.
- The parent `junction` account is persisted before redirecting to Link so early webhooks can resolve it by Junction `user_id`.
- Callback completion records Link outcome and enqueues reconcile, but reconcile/webhook/data API reads are the authority for source state.
- The importer writes `provider = "junction"` and preserves downstream source slug/device attribution in raw evidence, provenance, and `externalRef.resourceType`.
- v1 imports only the bounded resource set below.
- Webhook support verifies Svix signatures over the raw body, dedupes deliveries, and enqueues fetch/reconcile jobs rather than treating historical notifications as data payloads.
- Hosted and local storage migrations keep existing connections readable and do not leak Junction API keys into account records, token exports, logs, or raw artifacts.

## Reviewed inputs

- Supplied Junction plan and critique.
- Current Murph provider architecture in `docs/device-provider-contribution-kit.md` and `docs/device-sync-hosted-control-plane.md`.
- Current code seams:
  - `packages/importers/src/device-providers/provider-descriptors.ts`
  - `packages/device-syncd/src/types.ts`
  - `packages/device-syncd/src/public-ingress.ts`
  - `packages/device-syncd/src/config/provider-manifests.ts`
  - `packages/device-syncd/src/store/schema.ts`
  - `packages/device-syncd/src/service.ts`
  - `apps/web/src/lib/device-sync/prisma-store/connections.ts`
  - `apps/web/prisma/schema.prisma`
  - `packages/query/src/wearables/provider-policy.ts`
- Junction docs for Link token generation, users, connected providers, resources, timestamps, data attribution, and webhooks. See references at the end.

## Current repo facts this plan depends on

- `DeviceProviderTransportMode` currently has OAuth, scheduled polling, webhook, async export, SDK, and XML modes, but no hosted-link mode.
- `DeviceSyncPublicIngress.describeProvider()` currently requires `descriptor.oauth.callbackPath`.
- `startConnection()` always calls `provider.buildConnectUrl()`.
- `handleOAuthCallback()` requires an OAuth `code` and calls `provider.exchangeAuthorizationCode()`.
- `ProviderConnectionResult` and `UpsertPublicDeviceSyncConnectionInput` require `tokens`.
- Local SQLite stores `device_credential_state.access_token_encrypted` as `not null`; hosted Postgres has nullable token columns, but hosted upsert still encrypts an access token unconditionally.
- Account metadata is intentionally shallow and scalar-only through `sanitizeStoredDeviceSyncMetadata()`. Do not store `connectedSources: []` or nested `resourceAvailability` there.
- Query selection derives provider identity from `externalRef.system`. If Junction records use `system = "junction"`, source-specific ranking needs explicit query policy support; it will not happen automatically from source slug alone.

## Scope

In scope:

- Generic hosted-link and provider-config auth seams in device sync.
- Junction provider descriptor, manifest, env parsing, client, transport, polling jobs, and importer.
- Hosted/local storage migrations required for provider-config auth.
- A first-class, compact source-status projection for Junction child sources. This is intentionally a small data-model change rather than metadata packing.
- Junction webhook verification and job routing after polling works.
- Focused docs/tests for the new seams.

Out of scope for the first implementation:

- Registering `junction_oura`, `junction_garmin`, or any other downstream pseudo-provider.
- Apple HealthKit, Android Health Connect, Samsung Health, or other SDK-backed mobile ingestion through web Link.
- Glucose/CGM, nutrition, blood pressure, stress, workout streams, and body-temperature deltas as default imports.
- Junction Sense aggregation API.
- A full source-level settings UI if the first shipped UI can show one Junction card.
- Replacing existing direct Oura/Garmin/WHOOP/Strava providers.

## Key decisions

1. Register one Murph provider: `junction`.
2. Store Junction `user_id` as `externalAccountId`.
3. Use `externalRef.system = "junction"` for canonical records.
4. Encode downstream source in `externalRef.resourceType`, for example `oura:sleep` or `dexcom_v3:glucose`, and preserve `source.slug`, `source.type`, `source.device_id`, app id, workout id, and sport when present.
5. Add `hosted_link` as a generic transport mode. Do not model Junction Link as OAuth.
6. Add provider-config auth. Junction uses `secretRef = "env:JUNCTION_API_KEY"` or equivalent provider config, not account tokens.
7. Add `JUNCTION_CLIENT_USER_ID_SECRET`; compute `client_user_id` as `murph_` plus a base64url HMAC digest prefix. Do not send raw Murph ids to Junction.
8. Persist the parent account during begin-connection before redirecting to Link.
9. Treat callback result as weak. It records outcome and triggers reconcile; it is not the only source of connection truth.
10. Add a minimal source projection in the Junction connection/polling slice so webhooks, settings, and future query policy can reason about downstream providers without parsing raw artifacts.
11. Keep query priority provider-level in v1. Add source-aware query policy only after imported provenance and source projection are both in place.

## Architecture

```txt
settings / CLI
  -> DeviceSyncPublicIngress.startConnection("junction")
    -> junction.beginConnection()
      -> ensure Junction user by HMAC client_user_id
      -> upsert parent junction account before redirect
      -> generate Junction Link token
      -> return link_web_url

Junction callback
  -> DeviceSyncPublicIngress.handleConnectionCallback("junction")
    -> consume Murph state / murph_state
    -> record success, cancel, error, or unknown return
    -> enqueue reconcile
    -> redirect back to settings

worker reconcile/backfill/resource job
  -> list Junction connected providers/resources
  -> update compact source projection by downstream source slug
  -> fetch configured summary and timeseries resources
  -> import JunctionSnapshot through @murphai/importers
  -> @murphai/core writes canonical health records

Junction webhook
  -> verify raw-body Svix signature
  -> claim provider + trace id
  -> resolve parent account by Junction user_id
  -> enqueue reconcile/resource job
  -> complete trace transactionally after wake/job signal is durable
```

## Implementation plan

### 1. Add the generic connection/auth seam first

Files:

- `packages/importers/src/device-providers/provider-descriptors.ts`
- `packages/device-syncd/src/client.ts`
- `packages/device-syncd/src/types.ts`
- `packages/device-syncd/src/public-ingress.ts`
- `packages/device-syncd/src/http.ts`
- `packages/device-syncd/src/service.ts`
- `packages/device-syncd/src/store/schema.ts`
- `packages/device-syncd/src/store/accounts.ts`
- `apps/web/prisma/schema.prisma`
- `apps/web/src/lib/device-sync/prisma-store/connections.ts`
- `apps/web/src/lib/device-sync/internal-runtime.ts`
- `apps/web/src/lib/device-sync/public-ingress-service.ts`

Changes:

- Add `hosted_link` to `DeviceProviderTransportMode`.
- Add a `link` descriptor beside `oauth`, for example:

```ts
interface DeviceProviderHostedLinkDescriptor {
  callbackPath: string;
  defaultProviderFilter?: readonly string[];
}
```

- Extend public descriptors so providers can expose `connectionMode: "oauth_callback" | "hosted_link"` and a nullable/generic callback path without making `describeProvider()` throw for non-OAuth providers.
- Add generic provider hooks:

```ts
interface ProviderBeginConnectionContext {
  state: string;
  ownerId?: string | null;
  callbackUrl: string;
  publicBaseUrl: string;
  now: string;
  scopes: string[];
}

interface ProviderBeginConnectionResult {
  authorizationUrl: string;
  connectionSeed?: ProviderConnectionSeed;
  stateMetadata?: Record<string, unknown>;
  scopes?: string[];
}

interface ProviderCompleteConnectionContext {
  callbackUrl: string;
  state: string;
  stateMetadata?: Record<string, unknown>;
  query: URLSearchParams;
  now: string;
  grantedScopes: string[];
}
```

- Keep existing OAuth providers on adapter defaults:
  - `beginConnection = buildConnectUrl`
  - `completeConnectionCallback = exchangeAuthorizationCode`
- Add `ProviderAuthMaterial`:

```ts
type ProviderAuthMaterial =
  | { kind: "account_tokens"; tokens: ProviderAuthTokens }
  | { kind: "provider_config"; secretRef: string };
```

- Let `ProviderConnectionResult` and `UpsertPublicDeviceSyncConnectionInput` use `auth` instead of mandatory `tokens`.
- Add a `connecting` account status, or an equivalent explicit pending-link state. Preferred: add `connecting` so Link-started accounts are not displayed as fully synced before any source is confirmed.
- Update webhook acceptance so Junction `provider.connection.created` can advance a `connecting` account to `active`.
- Add storage migrations:
  - Local SQLite: bump `DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION`; add `auth_kind`, nullable token fields or a provider-config credential row, and `provider_secret_ref`.
  - Hosted Postgres: add `auth_kind` and `provider_secret_ref` to `device_connection`; keep token fields nullable.
- Update hosted runtime snapshot/apply/hydration so provider-config accounts can be restored into local runtime without a token bundle.
- Keep token export/refresh routes fail-closed for provider-config accounts with a clear `PROVIDER_CONFIG_AUTH_NOT_EXPORTABLE` style error.

Do this before any Junction-specific REST calls. It is the real architectural change.

### 2. Add Junction descriptor, env, and provider manifest

Files:

- `packages/importers/src/device-providers/provider-descriptors.ts`
- `packages/importers/src/device-providers/defaults.ts`
- `packages/importers/src/device-providers/index.ts`
- `packages/device-syncd/src/config/provider-env.ts`
- `packages/device-syncd/src/config/provider-types.ts`
- `packages/device-syncd/src/config/provider-manifests.ts`
- `packages/device-syncd/src/config/provider-factory.ts`
- `packages/device-syncd/src/index.ts`
- `packages/device-syncd/package.json`

Descriptor:

```ts
provider: "junction"
displayName: "Junction"
transportModes: ["hosted_link", "scheduled_poll", "webhook_push"]
link.callbackPath: "/link/junction/callback"
webhook.path: "/webhooks/junction"
sync.jobKinds: ["backfill", "reconcile", "resource"]
sync.supportsRemoteDisconnect: true
sync.supportsTokenRefresh: false
normalization.metricFamilies: ["activity", "sleep", "cardio", "respiration", "blood_oxygen", "body", "session"]
```

Default web-Link provider filter:

```txt
oura, fitbit, garmin, whoop, strava, withings, dexcom_v3,
freestyle_libre, abbott_libreview, eight_sleep, renpho
```

Explicitly exclude SDK/mobile-only sources from the web-Link MVP until a mobile SDK slice exists:

```txt
apple_health_kit, health_connect, samsung_health
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

Provider-owned secrets stay provider-owned. Do not add `JUNCTION_WEBHOOK_SECRET` to generic hosted/local env shapes or serialized runtime config.

Serializable config may include base URL, filters, resource lists, windows, and timeouts. It must not include the API key, client-user-id HMAC secret, webhook secret, or `fetchImpl`.

### 3. Implement the Junction client and connection flow

Files:

- `packages/device-syncd/src/providers/junction-client.ts`
- `packages/device-syncd/src/providers/junction.ts`
- `packages/device-syncd/src/public-ingress.ts`
- `apps/web/app/api/device-sync/link/[provider]/callback/route.ts`
- `packages/device-syncd/src/http.ts`

Client methods:

- Create Junction user.
- Resolve user by `client_user_id`, or parse the documented create-conflict response that includes `user_id`.
- Generate Link token.
- Get connected providers for a user.
- Fetch summary resources.
- Fetch timeseries resources.
- Deregister connection if remote disconnect is enabled for a downstream source.

Begin connection:

1. Build `client_user_id` with HMAC:

```ts
clientUserId = "murph_" + hmacSha256Base64Url(secret, ownerId).slice(0, 32)
```

2. Create or resolve Junction user.
3. Upsert the Murph parent account before redirect:
   - `provider = "junction"`
   - `externalAccountId = junctionUserId`
   - `status = "connecting"`
   - `auth.kind = "provider_config"`
   - `auth.secretRef = "env:JUNCTION_API_KEY"`
   - scalar metadata only, such as `clientUserIdHash`, `linkPending`, `lastLinkStartedAt`
4. Store state metadata:
   - owner id
   - Junction user id
   - client-user-id hash, not raw client-user-id if avoidable
   - provider filter
5. Generate a Link token with `redirect_url` pointing at the generic link callback. Use `murph_state` in the URL to avoid colliding with any Junction/provider callback fields.
6. Return `link_web_url`.

Callback:

1. Consume `murph_state` or `state` through the generic connection callback path.
2. Classify outcome as `success`, `error`, `cancelled`, or `unknown`.
3. Persist only scalar outcome metadata and enqueue a reconcile job.
4. Do not depend on callback to finalize source state.

Reconcile is authoritative. It fetches `GET /v2/user/providers/{user_id}` and updates account/source projections based on Junction status/resource availability.

### 4. Add source projection deliberately

Do not put connected-source arrays or resource availability maps into account metadata. Current metadata sanitization drops arrays and nested objects by design.

Add this model in the Junction connect/polling PR. Even if the first UI shows only one Junction card, the projection gives webhook handling and future query policy a durable place to store source state.

- Local SQLite: add `device_connection_source` or `device_source_state`.
- Hosted Postgres: add `device_connection_source`.
- Key by parent connection id plus source slug.
- Store only compact fields:
  - source slug
  - display name
  - status
  - created/updated timestamps
  - shallow resource availability summary
  - last error code/message if Junction exposes one

Keep full source/resource payloads in raw import artifacts plus reconcile evidence. The source table is a status and routing projection, not a second copy of Junction's API payloads.

### 5. Implement polling-first data import

Files:

- `packages/device-syncd/src/providers/junction.ts`
- `packages/importers/src/device-providers/junction.ts`
- `packages/importers/src/device-providers/defaults.ts`
- `packages/importers/src/device-providers/index.ts`
- `packages/importers/src/device-providers/metric-catalog.ts` only if a new metric is truly needed

Default v1 resources:

```txt
summary:
  profile
  activity
  sleep
  workouts
  body

timeseries:
  steps
  heartrate
  hrv
  respiratory_rate
  blood_oxygen
  weight
```

Keep these configurable but not default-enabled in v1:

```txt
glucose
nutrition
blood_pressure
stress_level
workout_* streams
body_temperature_delta
high-frequency calories_active and distance
```

Job kinds:

- `backfill`: bounded initial fetch window, default 90 days.
- `reconcile`: rolling fetch window, default 7 days.
- `resource`: webhook-triggered fetch for a specific resource/provider/date range/object.

Snapshot shape:

```ts
interface JunctionSnapshotInput {
  accountId: string;
  importedAt: string;
  windowStart?: string;
  windowEnd?: string;
  user?: unknown;
  connections?: unknown[];
  resources?: unknown[];
  summaries?: Partial<Record<JunctionSummaryResource, unknown[]>>;
  timeseries?: Partial<Record<JunctionTimeseriesResource, unknown[]>>;
  webhook?: {
    eventType?: string;
    sourceSlug?: string;
    resource?: string;
    objectId?: string;
    traceId?: string;
    occurredAt?: string;
  };
}
```

Normalization rules:

- Preserve useful raw upstream sections with `createRawArtifact()`.
- Emit existing Murph shapes first:
  - `activity` summary -> `observation` metrics like daily steps, distance, calories.
  - `sleep` summary -> `sleep_session` plus sleep metrics.
  - `workouts` summary -> `activity_session`.
  - `body` summary -> weight/body metrics where current canonical metrics exist.
  - `heartrate`, `hrv`, `respiratory_rate`, `blood_oxygen`, `steps`, `weight` -> samples or observations according to existing stream support.
- Use `externalRef.system = "junction"`.
- Use `externalRef.resourceType = "${sourceSlug}:${resource}"`.
- Use Junction object id as `resourceId`; if absent, derive a stable hash from source slug, resource, timestamp, metric, and raw payload identity.
- Add source fields to event/sample `fields` where useful:
  - `junctionSourceSlug`
  - `junctionSourceType`
  - `junctionDeviceId`
  - `junctionAppId`
  - `junctionWorkoutId`
  - `junctionSport`

Timestamp policy:

- Preserve raw timestamp evidence for every imported object.
- Treat normal Junction timestamps as UTC ISO 8601.
- For `abbott_libreview` and `freestyle_libre`, do not silently interpret floating time as UTC. Preserve raw timestamp and mark the time-zone source as floating/user fallback/absent in fields or provenance until a canonical time-zone field exists.
- Use `timezone_offset` when present. If it is `null`, retain that fact instead of inventing precision.

### 6. Add source-aware priority only after provenance lands

For the first import PR, set Junction descriptor priority below direct Oura/Garmin/WHOOP/Strava for overlapping metrics and above unknown providers.

Do not add `sourceOverrides` to the descriptor unless query can consume them. Current query priority only sees `externalRef.system`, so it will rank `junction` as one provider.

Follow-up query work, if needed:

- Teach wearable candidates to derive `upstreamSourceSlug` from `externalRef.resourceType` when `system === "junction"`.
- Extend provider policy to score `junction` candidates using source slug and metric family.
- Keep direct providers preferred for direct-supported sources unless product policy says otherwise.
- Let Junction win for sources Murph does not support directly.

### 7. Add webhooks after polling works

Files:

- `packages/device-syncd/src/providers/junction.ts`
- `packages/device-syncd/src/webhook-verification.ts` only if shared helpers need expansion
- `apps/web/app/api/device-sync/webhooks/[provider]/route.ts`
- `apps/web/src/lib/device-sync/wake-service.ts`
- `packages/device-syncd/test/public-ingress.test.ts`
- `packages/device-syncd/test/junction-provider.test.ts`

Webhook rules:

- Verify the raw body with Junction's Svix headers:
  - `svix-id`
  - `svix-timestamp`
  - `svix-signature`
- Prefer manual verification with built-in crypto if it stays small and testable. If the Svix SDK is used, treat it as a dependency change and update the lockfile plus supply-chain notes.
- Use top-level `user_id` as Junction account identity.
- Claim dedupe by provider plus a stable trace id. Prefer `svix-id`; fall back to a hash of event type, user id, object id/date range, and updated timestamp.
- `provider.connection.created`: update source projection if present, mark parent active, enqueue reconcile/backfill.
- `historical.data.{RESOURCE}.created`: enqueue a bounded fetch. This event is a notification, not the historical data payload.
- `daily.data.{RESOURCE}.created|updated`: import directly only when the payload is complete, bounded, and already matches the expected resource shape; otherwise enqueue a resource fetch.
- `message.attempt.exhausted`: mark webhook health and enqueue reconcile if the event maps to a known account.
- Unknown account webhooks should retry, because Link-created webhooks can beat browser callback completion.

### 8. Hosted and local UX

Hosted settings:

- Add one configured source card: "Junction".
- CTA: "Connect devices".
- Do not create source-specific cards until source projection exists.
- Callback redirects back to settings with normal existing callback status parameters.

Local CLI/control plane:

- `GET /connect/junction` and `POST /providers/junction/connect` return/redirect to `link_web_url`.
- Add public local route `GET /link/junction/callback`.
- Keep existing `/oauth/:provider/callback` for OAuth providers.

Disconnect:

- Disconnecting the parent Junction account should stop Murph jobs and mark the parent disconnected.
- Remote deregistration of individual downstream sources can be added after source projection exists.

## Files to touch

Importers:

```txt
packages/importers/src/device-providers/provider-descriptors.ts
packages/importers/src/device-providers/junction.ts
packages/importers/src/device-providers/defaults.ts
packages/importers/src/device-providers/index.ts
packages/importers/src/device-providers/metric-catalog.ts
packages/importers/test/provider-descriptors.test.ts
packages/importers/test/device-providers-junction.test.ts
packages/importers/README.md
```

Device sync daemon:

```txt
packages/device-syncd/src/types.ts
packages/device-syncd/src/client.ts
packages/device-syncd/src/public-ingress.ts
packages/device-syncd/src/http.ts
packages/device-syncd/src/service.ts
packages/device-syncd/src/store/schema.ts
packages/device-syncd/src/store/accounts.ts
packages/device-syncd/src/store/hosted-account-hydration.ts
packages/device-syncd/src/providers/junction.ts
packages/device-syncd/src/providers/junction-client.ts
packages/device-syncd/src/config/provider-env.ts
packages/device-syncd/src/config/provider-types.ts
packages/device-syncd/src/config/provider-manifests.ts
packages/device-syncd/src/config/serializable-provider-configs.ts
packages/device-syncd/src/config/provider-factory.ts
packages/device-syncd/src/index.ts
packages/device-syncd/package.json
packages/device-syncd/README.md
```

Hosted web:

```txt
apps/web/prisma/schema.prisma
apps/web/prisma/migrations/<new-junction-auth-kind-migration>/migration.sql
apps/web/src/lib/device-sync/prisma-store/connections.ts
apps/web/src/lib/device-sync/prisma-store/connection-records.ts
apps/web/src/lib/device-sync/prisma-store/connection-secrets.ts
apps/web/src/lib/device-sync/internal-runtime.ts
apps/web/src/lib/device-sync/public-ingress-service.ts
apps/web/src/lib/device-sync/settings-surface.ts
apps/web/app/api/device-sync/link/[provider]/callback/route.ts
apps/web/test/device-sync*.test.ts
```

Query, only if source-aware priority is in scope:

```txt
packages/query/src/wearables/candidates.ts
packages/query/src/wearables/provider-policy.ts
packages/query/src/wearables/types.ts
packages/query/test/wearables-*.test.ts
```

Docs:

```txt
docs/device-provider-contribution-kit.md
docs/device-provider-compatibility-matrix.md
docs/device-sync-hosted-control-plane.md
agent-docs/references/testing-ci-map.md
```

Update docs only when implementation changes live behavior, verification commands, or provider compatibility claims.

## Recommended PR sequence

1. Generic hosted-link/provider-config auth seam.
   - No Junction data ingestion.
   - Existing OAuth providers must remain green.
2. Junction connect plus polling import.
   - Descriptor, env, client, HMAC user id, Link start/callback, parent account, source projection, reconcile, bounded resource fetch, importer.
3. Junction webhooks.
   - Raw-body Svix verification, dedupe, webhook-to-job routing, retry behavior.
4. Settings refinement.
   - Optional source-level display once the projection is useful to users.
5. Source-aware query priority.
   - Only after imported Junction provenance exists and product needs finer conflict resolution.

## Verification

Minimum commands for the generic seam PR:

```txt
pnpm typecheck
pnpm test:diff packages/device-syncd/src/types.ts packages/device-syncd/src/public-ingress.ts packages/device-syncd/src/service.ts apps/web/prisma/schema.prisma apps/web/src/lib/device-sync/prisma-store/connections.ts
pnpm --dir packages/device-syncd test:coverage
pnpm --dir apps/web verify
```

Minimum commands for the Junction polling PR:

```txt
pnpm typecheck
pnpm test:diff packages/device-syncd/src/providers/junction.ts packages/importers/src/device-providers/junction.ts
pnpm --dir packages/device-syncd test:coverage
pnpm --dir packages/importers test:coverage
```

Minimum commands for webhook PR:

```txt
pnpm typecheck
pnpm test:diff packages/device-syncd/src/providers/junction.ts apps/web/app/api/device-sync/webhooks/[provider]/route.ts
pnpm --dir packages/device-syncd test:coverage
pnpm --dir apps/web verify
```

Required focused tests:

- OAuth providers still start and complete.
- Hosted-link providers do not require `code`.
- State metadata reaches provider completion.
- Provider-config accounts can be created, listed, restored into hosted runtime, and scheduled without token export.
- Token export/refresh rejects provider-config accounts clearly.
- Junction `beginConnection()` creates or resolves a user, HMACs `client_user_id`, persists parent account, and returns `link_web_url`.
- Junction callback records outcome and enqueues reconcile.
- Junction reconcile fetches connected providers and configured resources.
- Junction importer preserves raw artifacts and source attribution.
- Junction floating-time fixtures do not silently convert Libre timestamps as UTC.
- Webhook signature verification accepts valid Svix requests and rejects invalid/replayed ones.
- Historical webhook events enqueue fetch jobs instead of importing empty payloads.
- Unknown-account webhooks return retryable errors until the parent account exists.

## Risks and mitigations

1. Risk: adding auth-kind support touches local SQLite, hosted Postgres, runtime snapshot/apply, and token export.
   Mitigation: land it alone before Junction provider code and keep OAuth provider tests green.

2. Risk: child-source status becomes hidden in metadata and later unusable.
   Mitigation: add the dedicated source projection with Junction connect/polling, but keep it compact and avoid mirroring full Junction payloads.

3. Risk: source priority is over-promised.
   Mitigation: v1 records enough source provenance and projection state to support source-aware ranking later, but query behavior stays provider-level until that policy is implemented.

4. Risk: high-frequency Junction resources create large imports.
   Mitigation: default to the bounded v1 resource list and keep high-frequency/CGM/nutrition behind explicit config.

5. Risk: callback and webhook race.
   Mitigation: create the parent account before Link and make reconcile authoritative.

6. Risk: timestamps lose meaning for floating-time sources.
   Mitigation: preserve raw timestamp, source slug, timezone offset/null, and fallback-time-zone source before normalizing.

7. Risk: webhook verification introduces supply-chain churn.
   Mitigation: implement a tested manual Svix verifier first unless the SDK is clearly safer; if adding a dependency, update lockfile and record the reason.

## References

- Junction Link token: https://docs.junction.com/api-reference/link/generate-link-token
- Junction create user: https://docs.junction.com/api-reference/user/create-user
- Junction connected providers: https://docs.junction.com/api-reference/user/get-users-connected-providers
- Junction Link launch limits: https://docs.junction.com/wearables/connecting-providers/launching_link
- Junction resources and sampling rates: https://docs.junction.com/wearables/providers/resources
- Junction timestamps/time zones: https://docs.junction.com/wearables/providers/timestamps-and-time-zones
- Junction data attribution: https://docs.junction.com/wearables/providers/data-attributions
- Junction webhooks: https://docs.junction.com/webhooks/introduction
- Junction webhook event structure: https://docs.junction.com/webhooks/event-structure
Completed: 2026-04-30
