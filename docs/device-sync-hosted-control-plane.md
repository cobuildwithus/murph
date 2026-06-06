# Device Sync Hosted Control Plane

Last verified against repo layout: 2026-05-13

## Current split

Murph's hosted device-sync stack is now split this way:

- `apps/web` is the canonical hosted control plane. It owns durable hosted device-sync facts in Postgres, including connection ownership, OAuth/session state, short-lived hosted connect intents, token-audit history, sparse sync signals, per-connection dirty state for webhook freshness, local-agent sessions, and the web-owned internal runtime snapshot/apply/connect-link/dirty-state/pending/ack routes.
- `apps/cloudflare` is the hosted execution plane only. During a hosted job it may call narrow signed web callbacks to fetch the current device-sync runtime snapshot, apply runtime updates, or start a provider connect link, but it is not a second durable device-sync control plane.
- local `device-syncd` remains the data plane that talks to provider APIs, normalizes provider payloads through `@murphai/importers`, and writes canonical health records into the local vault.

This is the live repo shape, not a future rollout plan.

## Shared ingress seam

`@murphai/device-syncd/public-ingress` remains the reusable callback and webhook core shared across local and hosted surfaces. It owns:

- provider connect URL creation
- OAuth state validation
- OAuth callback handling
- provider webhook verification and parsing
- duplicate webhook trace suppression
- dispatch into store-specific side effects

That seam is reused by:

- local `device-syncd` when operators expose or tunnel callback and webhook routes
- the hosted Next.js control plane in `apps/web`

It does not own canonical health-data import, token authority, or canonical hosted control facts.

## Hosted responsibilities

### `apps/web`

`apps/web` is responsible for:

- provider connect UI and authenticated settings routes
- OAuth start and callback routes
- public webhook routes
- provider-account ownership mapping through blind indexes plus opaque connection ids
- durable Postgres-owned connection summaries, webhook traces, token-audit history, sparse wake signals, per-connection dirty aggregates, and agent-session state
- token export and refresh flows for the local agent
- disconnect, pairing, and other hosted operational control flows
- the signed internal runtime snapshot, runtime apply, dirty-state fetch/pending/ack, and connect-target link routes consumed by hosted execution

`apps/web` must not:

- expose raw provider tokens to browsers
- become a canonical health-data store
- write health records into the vault directly

### `apps/cloudflare`

`apps/cloudflare` is responsible for:

- signed Temporal `ensure-processing` handling, per-user Durable Object coordination, and bounded hosted workspace invocation drive
- invoking signed internal `apps/web` callbacks when a hosted job needs current device-sync runtime authority
- consuming current runtime snapshots during a hosted job and sending narrow runtime updates back to web

`apps/cloudflare` must not:

- become the durable owner of hosted device-sync token escrow
- maintain a second canonical runtime snapshot store for device sync
- replace `apps/web` as the device-sync control plane

### Local `device-syncd`

Local `device-syncd` remains responsible for:

- local token cache and reconcile state
- scheduled reconcile and backfill execution
- direct provider API fetches for configured direct providers such as WHOOP, Oura, and Strava, plus Junction-backed targets such as Garmin when configured
- normalization and import through `@murphai/importers`
- all canonical vault writes for wearable data

## Trust boundary

### Hosted boundary

The hosted boundary may hold:

- provider client credentials
- per-user connection metadata and token-audit history in Postgres
- sparse webhook traces, wake signals, and dirty connection aggregates
- execution-time runtime snapshots and runtime updates passed across signed internal callbacks during a hosted job

The hosted boundary must fail closed on auth and never gain canonical vault-write authority.

### Local boundary

The local boundary may hold:

- a local cache of provider tokens
- local reconcile state and import history
- local sync schedules
- the vault path and canonical write capability

Local agents authenticate to hosted APIs with a server-to-server credential tied to one Murph user account and never shared with the browser runtime.

## Durable state placement

### Postgres in `apps/web`

Postgres remains required for hosted device sync because Vercel does not provide stable local disk for:

- OAuth state round-trips
- connection ownership mapping
- public connection metadata and token-audit history
- webhook dedupe and device-sync dirty coalescing
- sparse wake signals
- local-agent pairing and session records

Recommended durable tables remain:

- `device_connection`
- `device_token_audit`
- `device_oauth_session`
- `device_connect_intent`
- `device_webhook_trace`
- `device_sync_signal`
- `device_sync_dirty_connection`
- `device_agent_session`
- optional `device_webhook_subscription`

Postgres should keep only opaque ids, blind indexes, typed summaries, sparse signals, audit history, dirty resource/window summaries, and the canonical hosted runtime authority consumed by the internal snapshot/apply/dirty-state/pending/ack routes. It should not store canonical health facts.

`device_connect_intent` stores short-lived first-party Murph connect claims for hosted assistant-initiated wearable linking. The signed internal connect-link route returns only the first-party `/device/connect/:claim` URL to the runner. Opening that URL requires the authenticated Murph app session for the same member before provider OAuth starts. The provider callback then consumes OAuth state only for that same member. Intent rows must not store raw provider or Junction authorization URLs.

`device_sync_dirty_connection` is the coalescing point for high-cardinality device webhook backfills. It is keyed by hosted connection ID and tracks `dirty_revision`, `processed_revision`, first/latest dirty timestamps, widened safe windows, compact resource/source counters, and a compact `dirty_resources_json` map. It must not store raw provider request bodies, provider tokens, raw samples, or user-visible health facts. Provider-owned durable webhook work, such as Junction direct data or exact resource/delete/deauthorization jobs needed for later import, is event-triggered work and is stored in `device_sync_dirty_payload` as bounded encrypted/compressed payload rows until the runtime consumes and explicitly acknowledges those row ids.

### Cloudflare execution state

Cloudflare storage keeps hosted execution coordination state only, such as encrypted hosted workspace bundles, opaque runner residue, and other execution-plane metadata described in `ARCHITECTURE.md`.

When a hosted job needs device-sync access, Cloudflare must call the signed internal web routes to:

- fetch the current runtime snapshot
- apply narrow runtime updates
- fetch pending dirty device-sync state as a first-class work source
- fetch a specific dirty device-sync revision when processing an explicit lifecycle wake
- acknowledge processed dirty revisions after checkpoint-safe execution
- start a provider connect link

That execution-time access does not make Cloudflare the durable owner of hosted device-sync authority.

### Local runtime

The local vault runtime keeps:

- local token cache
- reconcile and import history
- schedule and job state

This local runtime remains the only place that writes wearable facts into the vault.

## API shape

### Hosted public routes

- `GET /api/device-sync/oauth/:provider/callback`
- `GET /api/device-sync/connect/:provider/callback`
- `GET /api/device-sync/webhooks/:provider`
- `POST /api/device-sync/webhooks/:provider`

These are internet-facing and provider-facing only. `:provider` is resolved through the shared provider-manifest registry, not an app-local provider list. Current configured providers include `junction`, `oura`, `strava`, and `whoop`; Junction-backed source providers such as Garmin are selected by connect target/source-provider metadata rather than by adding a separate hosted provider route.

### Hosted browser-facing connection routes

- `POST /api/connect-sources/:sourceId/start`
- `GET /device/connect/:claim`
- `POST /device/connect/:claim`
- `GET /device-sync/connect/complete`

These are the only browser-facing wearable connection start and completion routes. The settings start route resolves direct provider manifests and the connect-target catalog assembled by `@murphai/device-syncd/config`, so `/connect` can expose direct WHOOP/Oura/Strava targets plus Junction-backed Garmin/Fitbit-style sources when those providers are configured. The first-party `/device/connect/:claim` route is the hosted assistant confirmation path: GET renders login/confirmation state without mutating provider OAuth state, and POST starts provider OAuth only for the authenticated member that owns the claim. Successful hosted provider callbacks should redirect to the completion page so the user can continue into the text-Murph flow.

### Hosted settings-authenticated routes

- `GET /api/settings/device-sync`
- `GET /api/settings/device-sync/connections/:connectionId/status`
- `POST /api/settings/device-sync/connections/:connectionId/disconnect`

These are read/manage wearable routes for the hosted settings page. Ordinary reads should come from durable hosted metadata in Postgres. Live execution/runtime inspection belongs only on explicit operational routes.

### Hosted assertion-authenticated browser bridge routes

- `POST /api/device-sync/agents/pair`

These are browser-initiated but lower-level than the settings surface. They must use short-lived signed assertions with replay protection.

### Hosted local-agent routes

- `POST /api/device-sync/agent/connections/:connectionId/export-token-bundle`
- `POST /api/device-sync/agent/connections/:connectionId/refresh-token-bundle`
- `POST /api/device-sync/agent/session/revoke`
- `POST /api/device-sync/agent/connections/:connectionId/local-heartbeat`

These are authenticated by local-agent credentials, not browser cookies.

### Hosted internal runtime/control routes

- `POST /api/internal/device-sync/runtime/snapshot` on `apps/web`
- `POST /api/internal/device-sync/runtime/apply` on `apps/web`
- `POST /api/internal/device-sync/runtime/dirty-state` on `apps/web`
- `POST /api/internal/device-sync/runtime/dirty-pending` on `apps/web`
- `POST /api/internal/device-sync/runtime/dirty-ack` on `apps/web`
- `POST /api/internal/device-sync/connect-targets/:connectTarget/connect-link` on `apps/web`

These routes are authenticated by signed server-to-server traffic that never reaches the browser. `:connectTarget` is resolved through the same connect-target registry used by `/connect`; the target carries the manifest provider plus optional Junction `sourceProviderSlug` such as Garmin, Oura, or Strava. The connect-link route creates a short-lived first-party connect intent and returns `connectUrl` plus a compatibility `authorizationUrl` copy of the same first-party URL; it does not start provider OAuth or return raw provider/Junction URLs to hosted execution. `apps/web` remains the canonical device-sync control plane while `apps/cloudflare` invokes only the narrow runtime callbacks it needs during hosted execution. Dirty-state callbacks are device-sync-specific; they are not a generic mailbox wake broker.

## Runtime access strategy

The current hosted runtime strategy is:

1. `apps/web` remains the durable owner of hosted device-sync control facts and runtime authority.
2. A hosted job running through `apps/cloudflare` requests the current runtime snapshot from the signed internal web route only when execution needs device-sync access.
3. The hosted runner fetches pending dirty device-sync rows from web-owned Postgres as a normal work source; webhook freshness does not depend on immutable per-webhook mailbox payloads.
4. The hosted job sends narrow runtime updates back through the signed internal web apply route.
5. Dirty revisions are acknowledged through the dirty-ack route only after the dirty state has been converted into local runtime work and that local work has crossed the checkpoint boundary. Provider jobs that remain queued continue through the local device-sync scheduler.
6. Local-agent token export and refresh flows stay on the hosted web boundary.
7. Cloudflare does not keep a second durable token-escrow source of truth for device sync.

This keeps control-plane truth in web while still allowing hosted execution to consume the runtime state it needs during a job.

## Webhook Dirty Coalescing

Webhook ingress separates level-triggered dirty hints from event-triggered durable webhook work. Provider parsers declare each webhook as either `level_dirty_hint` or `durable_webhook_work`; hosted dirty state must not infer that exact webhook work can be dropped. Level webhooks may be coalesced only after committed dirty state exists. Durable webhook work must be persisted or retried; it is never satisfied by dirty state alone.

Provider webhook traces remain exact for side-effect-bearing accepted deliveries. Accepted level dirty hints write sparse audit signals and upsert `device_sync_dirty_connection` only when they create fresh dirty demand; later level hints for an already-pending connection can be accepted before trace claim. Durable webhook work still passes through exact trace claim and durable acceptance so provider-owned event work is not lost. The steady-state architecture does not use per-webhook hosted mailbox items or Vercel Workflows for freshness.

When a connection transitions from clean to dirty, webhook ingress commits the dirty state, appends one deterministic `device-sync.wake` mailbox handoff, and completes the trace in the same transaction. Additional level hints while already dirty are coalesced without another ingress wake. Durable webhook work appends independent encrypted payload rows under exact trace claim and is acknowledged by explicit payload row id, so concurrent durable deliveries do not need a connection-scoped acceptance lock. Dirty rows and remaining payload rows stay pending until hosted runtime device-sync work drains them through dirty-pending and dirty-ack callbacks; there is no dirty-row recovery sweep. Exact missed-wake recovery would need a future explicit pending-handoff ledger, not a dirty sweeper. Webhook and app paths do not send runner nudges directly to Cloudflare.

Temporal is the only normal wake orchestrator. When demand exists, it calls Cloudflare's signed `ensure-processing` adapter; Cloudflare returns `runtime_processing_accepted` or `retry_later` and owns runner start, wake, active-fence alarm cleanup, and execution cleanup.

For accepted webhooks, provider trace completion means durable audit and dirty acceptance committed. Internal wake delivery is not allowed to force provider retry after that transaction commits. Existing connection-established and disconnect wakes remain immediate lifecycle commands because they are explicit lifecycle commands, not high-cardinality freshness hints.

## Provider and connect-target split

Provider configuration is registry-owned by `@murphai/device-syncd/config`. Hosted routes resolve provider manifests for direct providers and resolve connect targets for user-facing source choices. This keeps direct WHOOP, direct Oura and Strava, and Junction-backed source providers such as Garmin/Oura/Strava on one control-plane shape instead of branching hosted persistence by provider.

### WHOOP direct provider

Hosted responsibilities:

- OAuth callback
- webhook verification and dedupe
- blind-index account mapping
- hosted web token refresh and agent export flows
- execution-time runtime snapshot/apply access when a hosted job needs it

Local responsibilities:

- fetch WHOOP collections and resources directly
- import delete and resource changes into the vault from hosted hints

### Oura direct or Junction-backed target

Hosted responsibilities:

- OAuth callback
- hosted web token refresh and agent export flows
- webhook subscription management when Oura webhooks are enabled
- Junction connect-target link generation when Oura is routed through Junction
- execution-time runtime snapshot/apply access when a hosted job needs it

Local responsibilities:

- polling-first reconcile against recent windows
- optional use of hosted webhook signals
- local imports into the vault

### Strava direct or Junction-backed target

Hosted responsibilities:

- OAuth callback
- hosted web token refresh and agent export flows
- app-global webhook preflight and dedupe when direct Strava webhooks are enabled
- Junction connect-target link generation when Strava is routed through Junction
- execution-time runtime snapshot/apply access when a hosted job needs it

Local responsibilities:

- polling-first reconcile against recent activity windows
- optional use of hosted webhook signals
- local imports into the vault

### Garmin via Junction

Hosted responsibilities:

- Junction connect-target link generation with Garmin carried as the Junction source provider
- hosted web token refresh and agent export flows through the Junction provider manifest
- execution-time runtime snapshot/apply access when a hosted job needs it

Local responsibilities:

- Junction-backed reconcile of Garmin summaries, timeseries, sleep, activity, and other configured resources
- local imports into the vault

## Local-only daemon contract

`device-syncd` still requires its own local daemon env contract:

- `DEVICE_SYNC_SECRET` is the daemon's local bootstrap and service secret
- `DEVICE_SYNC_CONTROL_TOKEN` is the daemon's loopback control-plane bearer token

Those are local-daemon concerns. They are not part of the hosted browser or hosted execution auth contract.

Hosted execution continues to use signed internal web callbacks and hosted agent/session credentials instead of the daemon's `DEVICE_SYNC_CONTROL_TOKEN`.
