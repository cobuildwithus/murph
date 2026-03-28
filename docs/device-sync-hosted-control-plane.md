# Device Sync Hosted Control Plane Proposal

Last verified against repo layout: 2026-03-23

## What exists today

`packages/device-syncd` currently combines three concerns in one local runtime:
- public OAuth callback and webhook ingress
- durable integration state such as OAuth state, encrypted provider tokens, webhook traces, and queued jobs in `.runtime/device-syncd.sqlite`
- local data-plane execution that fetches provider payloads and imports normalized snapshots into the vault through `@murph/importers`

That works well for local-first setups, but it makes production callback/webhook hosting awkward because the public surface is attached to the same long-lived local process that owns vault writes.

## Recommended split

Keep one shared provider-integrations core, but split execution into a hosted control plane and a local data plane.

### Shared core

Use the shared `DeviceSyncPublicIngress` layer for:
- provider connect URL creation
- OAuth state validation
- OAuth callback handling
- provider webhook verification/parsing
- duplicate webhook trace suppression
- callback/webhook dispatch into store-specific side effects

This shared layer is intentionally reusable by both:
- the existing local/tunneled `device-syncd` runtime
- a future hosted Next.js/Vercel control plane

### Hosted control plane (Vercel)

Responsibilities:
- user-authenticated provider connect UI
- OAuth start/callback routes
- public webhook routes
- provider account ownership mapping
- encrypted token escrow
- webhook subscription management where needed
- minimal durable control state such as OAuth sessions, webhook traces, pending sync signals, disconnect state, and local-agent pairing state
- optional token refresh helper so provider app secrets stay server-side

Non-responsibilities:
- no canonical health data store
- no provider payload normalization/import into the vault
- no direct writes into Murph canonical records

### Local data plane (`device-syncd` or successor local agent)

Responsibilities:
- local token cache
- scheduled reconcile/backfill execution
- direct WHOOP/Oura data fetches whenever possible
- normalization/import through `@murph/importers`
- the only component that writes health records into the local vault
- sparse synchronization with the hosted control plane for token export/refresh and pending-sync markers

## Trust-boundary change

### Before

`device-syncd` is both:
- the public internet-facing callback/webhook receiver
- the local daemon with access to the vault and canonical import path

### After

#### Hosted boundary

The hosted app becomes the internet-facing integration control plane. It may hold:
- provider client credentials
- encrypted user provider tokens
- per-user connection metadata
- webhook traces and pending-sync markers

It must **not** expose raw provider tokens to browsers, and it must **not** gain canonical vault write authority.

#### Local boundary

The local app remains the only canonical-writer. It may hold:
- a local cache of provider tokens
- local reconcile state and import history
- local sync schedules
- the vault path and canonical write capability

The local agent authenticates to the hosted backend with a server-to-server credential that is tied to one Murph user account and never shared with the browser runtime.

## Is Postgres needed?

For a real hosted Vercel deployment, yes.

A durable database is needed because Vercel functions do not provide a stable local filesystem for:
- OAuth state round-trips
- connection ownership mapping
- encrypted token escrow
- webhook dedupe
- pending-sync signals
- local-agent pairing/session records

Use Postgres for hosted integration state only.

### What should live in Postgres

Recommended tables:

#### `device_connection`
- `id`
- `user_id`
- `provider` (`whoop` | `oura`)
- `external_account_id`
- `display_name`
- `status` (`active` | `reauthorization_required` | `disconnected`)
- `scopes_json`
- `connected_at`
- `access_token_expires_at`
- `next_sync_hint_at` or latest hosted signal timestamp
- `metadata_json` for non-canonical provider identity details
- `created_at`, `updated_at`

#### `device_connection_secret`
- `connection_id`
- `access_token_encrypted`
- `refresh_token_encrypted`
- `token_version`
- `key_version`
- `updated_at`

Keep secrets in a separate table from user-visible connection metadata.

### Secret hygiene and rotation

- Keep real hosted control-plane credentials in an untracked local `.env` for development or the deployment platform's secret manager. The repo-owned `apps/web/.env.example` file should remain placeholder-only.
- A raw filesystem zip/tar of a repo clone is still an exposure when ignored local `apps/web/.env` or `.next` artifacts exist, even if git itself is clean. Use the guarded source-bundle path (`scripts/package-audit-context.sh` / `pnpm zip:src`) for review handoff instead of archiving the clone directly; it stages git-visible files and filters blocked local residue from the bundle.
- If any real hosted `.env` or deploy secret was exposed, rotate at least:
  - the Postgres credential behind `DATABASE_URL`
  - `DEVICE_SYNC_ENCRYPTION_KEY` and `DEVICE_SYNC_ENCRYPTION_KEY_VERSION`
  - `WHOOP_CLIENT_SECRET`
  - `OURA_CLIENT_SECRET`
  - `OURA_WEBHOOK_VERIFICATION_TOKEN`
- Treat a leaked raw clone/archive that contained the local hosted `.env` the same way as a direct secret exposure for rotation and re-authorization decisions.
- Today the hosted app records `key_version` with each `device_connection_secret` row, but runtime decryption still uses one active `DEVICE_SYNC_ENCRYPTION_KEY`. A version bump by itself does not preserve access to older escrowed token rows.
- That means encryption-key rotation needs one of two operational paths before the cutover:
  - re-encrypt every affected escrowed token bundle while the old key is still available, then switch the deployment to the new key/version
  - revoke or delete the old escrowed token rows and force each affected provider connection through a fresh authorization flow
- If the old database credential and the old encryption key may both have been exposed together, treat the existing escrowed provider tokens as compromised and prefer revocation/re-authorization over silent carry-forward.

#### `device_oauth_session`
- `state`
- `user_id`
- `provider`
- `return_to`
- `expires_at`
- `created_at`

#### `device_webhook_trace`
- `provider`
- `trace_id` or provider-native dedupe key
- `external_account_id`
- `event_type`
- `received_at`
- optional small payload/debug JSON with a retention policy

#### `device_sync_signal`
Append-only mailbox for the local app to poll with a cursor:
- `id` / sequence
- `connection_id`
- `provider`
- `kind` (`initial_backfill`, `reconcile_hint`, `resource_changed`, `resource_deleted`, `disconnected`, `reauthorization_required`)
- `payload_json`
- `created_at`

#### `device_agent_session`
- `id`
- `user_id`
- `label`
- hashed agent token or opaque credential id
- `expires_at`
- `last_seen_at`
- `revoked_at`
- `revoke_reason`
- `replaced_by_session_id`
- `created_at`

#### optional `device_webhook_subscription`
Especially useful for Oura:
- `provider`
- `data_type`
- `event_type`
- `callback_url`
- provider subscription id
- verification status / last verified at
- `created_at`, `updated_at`

### What should not live in Postgres
- canonical health records
- imported WHOOP/Oura collection payloads as the source of truth
- normalized samples/events that belong in the local vault
- long-term raw health snapshots unless you explicitly choose a debug/audit retention policy

## High-level API shape

### Hosted public routes

These are internet-facing and provider-facing only.

- `GET /api/device-sync/oauth/:provider/start`
- `GET /api/device-sync/oauth/:provider/callback`
- `POST /api/device-sync/webhooks/whoop`
- `POST /api/device-sync/webhooks/oura`

### Hosted browser-authenticated routes

These are for the signed-in user and return only safe metadata.

Browser auth for these routes should come from a trusted front-end/auth proxy that mints a fresh signed assertion per request. The signed payload should include the user claims plus `iat`, `exp`, `nonce`, `aud`, `method`, `path`, and `origin`, with a lifetime no longer than a few minutes. Sensitive mutations such as pairing or disconnect should reject replayed assertions by consuming each nonce once server-side.

- `GET /api/device-sync/connections`
- `POST /api/device-sync/connections/:provider/connect`
- `POST /api/device-sync/connections/:connectionId/disconnect`
- `POST /api/device-sync/agents/pair`
- `GET /api/device-sync/connections/:connectionId/status`

The browser should see provider label, display name, status, scopes, last webhook time, and local-sync-needed indicators. It should never see raw provider tokens.

### Hosted local-agent routes

Authenticated by a local-agent credential, not by browser cookies.

- `GET /api/device-sync/agent/signals?after=<cursor>`
- `POST /api/device-sync/agent/connections/:connectionId/export-token-bundle`
- `POST /api/device-sync/agent/connections/:connectionId/refresh-token-bundle`
- `POST /api/device-sync/agent/session/revoke`
- `POST /api/device-sync/agent/signals/ack` (optional if you keep cursor-only semantics)
- `POST /api/device-sync/agent/connections/:connectionId/local-heartbeat`

Current hosted agent-session behavior:
- `POST /api/device-sync/agents/pair` creates a 24-hour bearer session.
- Agent bearer lookup fails closed when the session is expired or revoked.
- `export-token-bundle` and `refresh-token-bundle` both return a replacement bearer in `agentSession.bearerToken` plus the new session expiry.
- The previous bearer is revoked immediately when export/refresh rotates the session.
- `POST /api/device-sync/agent/session/revoke` lets the local agent explicitly invalidate its current bearer.

## What should move out of `device-syncd`

Move to the hosted control plane in hosted mode:
- public OAuth callback routes
- public webhook routes
- OAuth session persistence
- per-user provider connection ownership mapping
- encrypted hosted token escrow
- webhook dedupe traces
- pending-sync mailbox/signals for the local app
- provider webhook subscription management
- browser-facing connect/disconnect metadata surface
- optional token-refresh helper if client secrets remain hosted-only

## What should stay local

Keep local-only:
- actual WHOOP/Oura health payload fetches where feasible
- reconcile/backfill execution
- local token cache
- import scheduling tied to the vault
- all normalization/import logic
- all canonical vault writes
- any local-only fallback mode where the operator tunnels callback URLs back to the local daemon

## WHOOP and Oura specifics

### WHOOP

Recommended hosted responsibilities:
- OAuth callback
- webhook verification and dedupe
- external-account mapping
- token escrow
- optional refresh helper

Recommended local responsibilities:
- fetch WHOOP collections and resources directly from WHOOP APIs
- import delete/resource changes into the vault based on hosted webhook hints

WHOOP refresh-token rotation means only one side should be authoritative for refreshes at a time. If the hosted app owns the client secret, the safest design is a hosted refresh endpoint plus local caching.

### Oura

Recommended hosted responsibilities:
- OAuth callback
- token escrow
- webhook subscription management if you enable Oura webhooks
- optional refresh helper

Recommended local responsibilities:
- polling-first reconcile against recent windows
- optional use of hosted webhook signals when Oura webhook subscriptions are configured
- local imports into the vault

Oura works fine in a polling-first mode, so hosted webhook support for Oura is helpful but not required for basic correctness.

## Can local remain the only place that fetches provider health data?

Mostly yes, with two important caveats.

### What can stay local
- fetching WHOOP health collections/resources
- fetching Oura health collections/resources
- normalization/import into the local vault

### What still has to happen in the hosted app
- OAuth authorization-code exchange
- minimal provider identity lookup needed to map the provider account to the signed-in Murph user
- webhook verification/receipt
- webhook subscription management
- token refresh assistance if the provider app client secret is kept server-side

So the local app can remain the only **health-data** fetcher, but the hosted app still needs to perform some provider **control-plane** interactions.

## Recommended token strategy

If the hosted app owns the provider client secret, do **not** ship that client secret to local apps.

Use this pattern instead:
1. hosted app stores encrypted tokens durably
2. local app exports a token bundle once, caches it locally, and persists the replacement agent bearer returned by the response
3. local app fetches provider data directly until access-token refresh or bearer renewal is needed
4. when refresh or renewal is needed, local app calls the hosted refresh endpoint with its latest bearer
5. hosted app refreshes tokens atomically when needed, updates escrow, and returns the new token bundle plus the next bearer session
6. local app discards the prior bearer immediately and continues syncing locally without proxying provider payloads through hosted

If the local agent lets its bearer expire, the hosted app rejects export/refresh/signals/heartbeat calls until the agent is paired again.

That preserves a local-first data plane without requiring every sync request to transit the hosted app.

## Sparse synchronization model

To avoid constant hosted chatter:
- local app polls `device_sync_signal` on startup, on manual sync, and on a modest timer
- hosted app never proxies normal provider data payloads
- hosted app is only consulted for control-plane events: pending signals, token export, token refresh, disconnect state, explicit session revoke, and bearer rotation/renewal through export or refresh

## Migration path

### Phase 1
- extract reusable callback/webhook core from `device-syncd`
- keep current local/tunneled flow working

### Phase 2
- build hosted control plane on Vercel using the shared ingress core and Postgres
- add agent pairing and sparse token/signal APIs

### Phase 3
- let local `device-syncd` run as data plane only when a hosted control plane is configured
- keep local public-ingress mode as an opt-in fallback for self-hosters and tunnel users

## Recommendation summary

The best split is:
- **hosted Vercel app = integration control plane**
- **local daemon = provider data plane + vault importer**
- **Postgres = durable hosted integration/auth state only**
- **shared callback/webhook logic = one reusable ingress layer, not duplicated between hosted and local modes**

That preserves the local vault as the source of truth while making OAuth callbacks and provider webhooks production-friendly.
