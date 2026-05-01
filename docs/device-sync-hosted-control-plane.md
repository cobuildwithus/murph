# Device Sync Hosted Control Plane

Last verified against repo layout: 2026-04-19

## Current split

Murph's hosted device-sync stack is now split this way:

- `apps/web` is the canonical hosted control plane. It owns durable hosted device-sync facts in Postgres, including connection ownership, OAuth/session state, token-audit history, sparse sync signals, local-agent sessions, and the web-owned internal runtime snapshot/apply/connect-link routes.
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
- durable Postgres-owned connection summaries, webhook traces, token-audit history, sparse wake signals, and agent-session state
- token export and refresh flows for the local agent
- disconnect, pairing, and other hosted operational control flows
- the signed internal runtime snapshot, runtime apply, and connect-target link routes consumed by hosted execution

`apps/web` must not:

- expose raw provider tokens to browsers
- become a canonical health-data store
- write health records into the vault directly

### `apps/cloudflare`

`apps/cloudflare` is responsible for:

- hosted execution coordination and per-user run orchestration
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
- direct WHOOP and Oura API fetches when the local data plane is active
- normalization and import through `@murphai/importers`
- all canonical vault writes for wearable data

## Trust boundary

### Hosted boundary

The hosted boundary may hold:

- provider client credentials
- per-user connection metadata and token-audit history in Postgres
- sparse webhook traces and wake signals
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

Postgres should keep only opaque ids, blind indexes, typed summaries, sparse signals, audit history, and the canonical hosted runtime authority consumed by the internal snapshot/apply routes. It should not store canonical health facts.

### Cloudflare execution state

Cloudflare storage keeps hosted execution coordination state only, such as encrypted hosted workspace bundles, opaque runner residue, and other execution-plane metadata described in `ARCHITECTURE.md`.

When a hosted job needs device-sync access, Cloudflare must call the signed internal web routes to:

- fetch the current runtime snapshot
- apply narrow runtime updates
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

These are the browser-facing wearable-management routes. Ordinary reads should come from durable hosted metadata in Postgres. Live execution/runtime inspection belongs only on explicit operational routes.

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
- `POST /api/internal/device-sync/connect-targets/:connectTarget/connect-link` on `apps/web`

These routes are authenticated by signed server-to-server traffic that never reaches the browser. `apps/web` remains the canonical device-sync control plane while `apps/cloudflare` invokes only the narrow runtime callbacks it needs during hosted execution.

## Runtime access strategy

The current hosted runtime strategy is:

1. `apps/web` remains the durable owner of hosted device-sync control facts and runtime authority.
2. A hosted job running through `apps/cloudflare` requests the current runtime snapshot from the signed internal web route only when execution needs device-sync access.
3. The hosted job sends narrow runtime updates back through the signed internal web apply route.
4. Local-agent token export and refresh flows stay on the hosted web boundary.
5. Cloudflare does not keep a second durable token-escrow source of truth for device sync.

This keeps control-plane truth in web while still allowing hosted execution to consume the runtime state it needs during a job.

## Provider split

### WHOOP

Hosted responsibilities:

- OAuth callback
- webhook verification and dedupe
- blind-index account mapping
- hosted web token refresh and agent export flows
- execution-time runtime snapshot/apply access when a hosted job needs it

Local responsibilities:

- fetch WHOOP collections and resources directly
- import delete and resource changes into the vault from hosted hints

### Oura

Hosted responsibilities:

- OAuth callback
- hosted web token refresh and agent export flows
- webhook subscription management when Oura webhooks are enabled
- execution-time runtime snapshot/apply access when a hosted job needs it

Local responsibilities:

- polling-first reconcile against recent windows
- optional use of hosted webhook signals
- local imports into the vault

## Local-only daemon contract

`device-syncd` still requires its own local daemon env contract:

- `DEVICE_SYNC_SECRET` is the daemon's local bootstrap and service secret
- `DEVICE_SYNC_CONTROL_TOKEN` is the daemon's loopback control-plane bearer token

Those are local-daemon concerns. They are not part of the hosted browser or hosted execution auth contract.

Hosted execution continues to use signed internal web callbacks and hosted agent/session credentials instead of the daemon's `DEVICE_SYNC_CONTROL_TOKEN`.
