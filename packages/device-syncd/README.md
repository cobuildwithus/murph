# @murphai/device-syncd

Workspace-private local device sync runtime for Murph.

Contributing a new wearable provider? Start with `docs/device-provider-contribution-kit.md` in the repo root, then use the scaffolds listed in `docs/templates/README.md`.

Murph's CLI can install, start, reuse, and stop this daemon for the selected vault through `murph device daemon ...`, so most operators should treat it as a built-in local service rather than a separately managed sidecar.

The daemon binds the control plane to localhost by default. CLI and web clients must authenticate that control plane with a bearer token. If provider callbacks or webhooks need public reachability, expose only the public callback/webhook routes through a separate listener or reverse proxy instead of widening `/accounts/*` and `/providers/*/connect`.

The package now also exports a reusable `DeviceSyncPublicIngress` layer that encapsulates provider-agnostic OAuth state, callback handling, and webhook verification/dispatch. Hosted or alternate HTTP surfaces should import that seam from `@murphai/device-syncd/public-ingress`; the package root stays daemon-oriented. That shared ingress is the seam for a future hosted Vercel control plane while keeping the current local/tunneled callback flow alive.
Daemon config readers and HTTP response helpers stay on `@murphai/device-syncd/config`
and `@murphai/device-syncd/http` instead of leaking back through the shared ingress seam.
For non-daemon callers, `@murphai/device-syncd/client` is the canonical shared control-plane client surface for base-url/token resolution, loopback safety checks, and JSON request helpers inside this workspace or bundled public tarballs.

What it does:
- serves a provider-agnostic local control plane for CLI and web auth flows
- owns OAuth connection state
- stores encrypted provider tokens in SQLite under `.runtime/operations/device-sync/state.sqlite`
- keeps `.runtime/operations/device-sync/**` local-only; those secrets, cursors, launcher artifacts, and logs are excluded from hosted workspace snapshots because the hosted lane has its own Cloudflare-owned device-sync control plane and token escrow
- accepts provider webhooks when a provider supports them
- runs background backfill and reconcile jobs
- serializes active jobs per account so rotating refresh-token flows do not race
- imports provider snapshots through `@murphai/importers`

Current providers:
- Garmin
- WHOOP
- Oura

## Shared public ingress

Use `DeviceSyncPublicIngress` when you need the same callback/webhook logic in a different HTTP surface:
- local `device-syncd` with an exposed public listener or tunnel
- a future hosted Next.js/Vercel control plane that stores durable integration state in Postgres

The shared ingress owns:
- provider connect URL creation
- OAuth state validation
- OAuth callback completion
- provider webhook verification/parsing
- webhook dedupe and account lookup hooks

It does **not** own canonical health-data import. The local data plane should still be the only component that normalizes provider payloads and writes them into the Murph vault.

## Provider model

`device-syncd` treats wearable providers as long-lived connectors with a shared lifecycle:
- one-time OAuth connect
- encrypted token storage with refresh support
- initial backfill
- scheduled reconcile polling
- optional webhook fan-in
- normalized snapshot import through `@murphai/importers`

Garmin uses OAuth plus scheduled polling. Once the operator configures the Garmin client ID and secret, the end-user flow is connect once and let scheduled sync keep the account fresh.

WHOOP uses OAuth plus webhooks.

Oura uses OAuth plus refresh tokens and works well in a polling-first mode, so the basic Murph setup does not require Oura webhooks. Once the operator configures the Oura client ID and secret, the end-user flow is just connect once and let scheduled sync keep the account fresh.

The provider lifecycle metadata used here now comes from the shared `@murphai/importers/device-providers/provider-descriptors` surface, so callback paths, default scopes, webhook capabilities, sync windows, metric families, and source-priority hints stay aligned between connector code and snapshot normalization.

## Environment

Required:
- `DEVICE_SYNC_VAULT_ROOT`
- `DEVICE_SYNC_PUBLIC_BASE_URL`
- `DEVICE_SYNC_SECRET` for the daemon's local bootstrap/service secret
- `DEVICE_SYNC_CONTROL_TOKEN` for the control-plane bearer token

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
- `OURA_WEBHOOK_VERIFICATION_TOKEN` when you want the daemon to answer Oura's webhook verification challenge over `GET /webhooks/oura`

Garmin settings:
- `GARMIN_CLIENT_ID`
- `GARMIN_CLIENT_SECRET`
- `GARMIN_AUTH_BASE_URL`
- `GARMIN_TOKEN_BASE_URL`
- `GARMIN_API_BASE_URL`
- `GARMIN_BACKFILL_DAYS`
- `GARMIN_RECONCILE_DAYS`
- `GARMIN_RECONCILE_INTERVAL_MS`
- `GARMIN_REQUEST_TIMEOUT_MS`

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

## Run

```bash
# from the repo root
node packages/device-syncd/dist/bin.js
```
