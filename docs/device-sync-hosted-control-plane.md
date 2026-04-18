# Device Sync Hosted Control Plane

Last verified against repo layout: 2026-04-13

## Current split

Murph now treats hosted device sync as a split system:

- `apps/web` is the public integration control plane for OAuth callbacks, webhooks, user-authenticated settings flows, agent pairing, and durable hosted metadata in Postgres
- `apps/cloudflare` owns the canonical decryptable hosted runtime snapshot and token escrow for device-sync connections, plus the signed internal read/apply routes the hosted runner uses
- local `device-syncd` remains the data plane that fetches provider payloads, normalizes them through `@murphai/importers`, and writes canonical health records into the local vault

This is no longer a future rollout plan. It is the current hosted direction indexed elsewhere in the repo.

## Shared ingress seam

`@murphai/device-syncd/public-ingress` is the reusable callback/webhook core shared across local and hosted surfaces. It owns:

- provider connect URL creation
- OAuth state validation
- OAuth callback handling
- provider webhook verification and parsing
- duplicate webhook trace suppression
- dispatch into store-specific side effects

That seam is reused by both:

- local `device-syncd` when operators expose or tunnel callback/webhook routes
- the hosted Vercel control plane in `apps/web`

It does not own canonical health-data import. The data plane still lives below the hosted control plane.

## Hosted responsibilities

### `apps/web`

`apps/web` is responsible for:

- provider connect UI and authenticated settings routes
- OAuth start/callback routes
- public webhook routes
- provider-account ownership mapping through blind indexes plus opaque connection ids
- durable Postgres-owned connection summaries, webhook traces, token-audit history, sparse wake signals, and agent-session state
- token export and refresh flows for the local agent
- disconnect, pairing, and other hosted operational control flows

`apps/web` must not:

- expose raw provider tokens to browsers
- become a canonical health-data store
- write health records into the vault directly

### `apps/cloudflare`

`apps/cloudflare` is responsible for:

- Cloudflare-owned encrypted per-user device-sync runtime snapshots
- canonical decryptable token escrow under the user root key
- signed internal runtime snapshot and apply routes
- hosted-runner access to current device-sync runtime state during hosted jobs

The Cloudflare runtime is the owner of decryptable hosted token bundles. Postgres keeps durable metadata and control-plane facts only.

### Local `device-syncd`

Local `device-syncd` remains responsible for:

- local token cache and reconcile state
- scheduled reconcile and backfill execution
- direct WHOOP and Oura API fetches when the local data plane is active
- normalization and import through `@murphai/importers`
- all canonical vault writes for wearable data

## Trust boundary

### Hosted boundary

The hosted boundary may hold:

- provider client credentials
- per-user connection metadata and token-audit history in Postgres
- encrypted provider tokens and mutable runtime state in Cloudflare-owned storage
- sparse webhook traces and wake signals

It must fail closed on auth and never gain canonical vault-write authority.

### Local boundary

The local boundary may hold:

- a local cache of provider tokens
- local reconcile state and import history
- local sync schedules
- the vault path and canonical write capability

Local agents authenticate to hosted APIs with a server-to-server credential tied to one Murph user account and never shared with the browser runtime.

## Durable state placement

### Postgres in `apps/web`

Postgres is required for hosted device sync because Vercel does not provide stable local disk for:

- OAuth state round-trips
- connection ownership mapping
- public connection metadata and token-audit history
- webhook dedupe
- sparse wake signals
- local-agent pairing and session records

Recommended durable tables remain:

- `device_connection`
- `device_token_audit`
- `device_oauth_session`
- `device_webhook_trace`
- `device_sync_signal`
- `device_agent_session`
- optional `device_webhook_subscription`

Postgres should keep only opaque ids, blind indexes, typed summaries, sparse signals, and audit history. It should not store raw provider tokens, raw provider payloads, or canonical health facts.

### Cloudflare device-sync runtime store

Cloudflare storage keeps:

- per-user encrypted runtime snapshots under the user root key
- connection snapshots plus local observation state
- canonical encrypted token bundles and token-version fencing
- signed internal read/apply routes plus metadata-only snapshot merges from `apps/web`

### Local runtime

The local vault runtime keeps:

- local token cache
- reconcile and import history
- schedule and job state

This local runtime remains the only place that writes wearable facts into the vault.

## API shape

### Hosted public routes

- `GET /api/device-sync/oauth/:provider/start`
- `GET /api/device-sync/oauth/:provider/callback`
- `POST /api/device-sync/webhooks/whoop`
- `POST /api/device-sync/webhooks/oura`

These are internet-facing and provider-facing only.

### Hosted settings-authenticated routes

- `GET /api/settings/device-sync`
- `GET /api/settings/device-sync/connections/:connectionId/status`
- `POST /api/settings/device-sync/providers/:provider/connect`
- `POST /api/settings/device-sync/connections/:connectionId/disconnect`

These are the only browser-facing wearable-management routes. Ordinary reads should come from durable hosted metadata in Postgres. Live Cloudflare runtime inspection belongs only on explicit operational routes.

### Hosted assertion-authenticated browser bridge routes

- `POST /api/device-sync/agents/pair`

These are browser-initiated but lower-level than the settings surface. They must use short-lived signed assertions with replay protection.

### Hosted local-agent routes

- `GET /api/device-sync/agent/signals?after=<cursor>`
- `POST /api/device-sync/agent/connections/:connectionId/export-token-bundle`
- `POST /api/device-sync/agent/connections/:connectionId/refresh-token-bundle`
- `POST /api/device-sync/agent/session/revoke`
- `POST /api/device-sync/agent/signals/ack`
- `POST /api/device-sync/agent/connections/:connectionId/local-heartbeat`

These are authenticated by local-agent credentials, not browser cookies.

### Hosted internal runtime/control routes

- `POST /api/internal/device-sync/runtime/snapshot` on `apps/web`
- `POST /api/internal/device-sync/runtime/apply` on `apps/web`
- `POST /api/internal/device-sync/providers/:provider/connect-link` on `apps/web`

These routes are authenticated by signed server-to-server traffic that never reaches the browser. `apps/web` remains the canonical control plane while the Cloudflare worker only invokes the signed runtime callbacks it needs during execution.

## Token strategy

The current hosted token strategy is:

1. Cloudflare runtime storage keeps encrypted token bundles durably under the user root key.
2. The local agent exports a token bundle when needed, caches it locally, and persists the replacement agent bearer from the response.
3. The local data plane fetches provider data directly until access-token refresh or bearer renewal is needed.
4. When refresh or renewal is needed, the local agent calls the hosted refresh endpoint with its latest bearer.
5. Hosted web refreshes provider tokens atomically, writes the updated token bundle into Cloudflare, and returns the next token bundle plus next agent bearer session.
6. The local agent discards the prior bearer immediately and continues syncing locally.

This keeps provider payload fetches local without proxying normal health-data traffic through hosted services.

## Provider split

### WHOOP

Hosted responsibilities:

- OAuth callback
- webhook verification and dedupe
- blind-index account mapping
- Cloudflare-owned token escrow
- optional refresh helper

Local responsibilities:

- fetch WHOOP collections and resources directly
- import delete and resource changes into the vault from hosted hints

### Oura

Hosted responsibilities:

- OAuth callback
- Cloudflare-owned token escrow
- webhook subscription management when Oura webhooks are enabled
- optional refresh helper

Local responsibilities:

- polling-first reconcile against recent windows
- optional use of hosted webhook signals
- local imports into the vault

## Local-only daemon contract

`device-syncd` still requires its own local daemon env contract:

- `DEVICE_SYNC_SECRET` is the daemon's local bootstrap and service secret
- `DEVICE_SYNC_CONTROL_TOKEN` is the daemon's loopback control-plane bearer token

Those are local-daemon concerns. They are not the browser-facing hosted control-plane contract.

The hosted Cloudflare runner currently still uses a device-sync codec secret internally when it hydrates token bundles inside the hosted runtime. That is separate from the local daemon control token and should not be documented as a browser or local-agent bearer.
