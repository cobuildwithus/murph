# @healthybob/device-syncd

Published local device sync runtime for Healthy Bob.

Healthy Bob's CLI can install, start, reuse, and stop this daemon for the selected vault through `healthybob device daemon ...`, so most operators should treat it as a built-in local service rather than a separately managed sidecar.

The daemon binds the control plane to localhost by default. CLI and web clients must authenticate that control plane with a bearer token. If provider callbacks or webhooks need public reachability, expose only the public callback/webhook routes through a separate listener or reverse proxy instead of widening `/accounts/*` and `/providers/*/connect`.

The package now also exports a reusable `DeviceSyncPublicIngress` layer that encapsulates provider-agnostic OAuth state, callback handling, and webhook verification/dispatch. That shared ingress is the seam for a future hosted Vercel control plane while keeping the current local/tunneled callback flow alive.

What it does:
- serves a provider-agnostic local control plane for CLI and web auth flows
- owns OAuth connection state
- stores encrypted provider tokens in SQLite under `.runtime/device-syncd.sqlite`
- accepts provider webhooks when a provider supports them
- runs background backfill and reconcile jobs
- serializes active jobs per account so rotating refresh-token flows do not race
- imports provider snapshots through `@healthybob/importers`

Current providers:
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

It does **not** own canonical health-data import. The local data plane should still be the only component that normalizes provider payloads and writes them into the Healthy Bob vault.

## Provider model

`device-syncd` treats wearable providers as long-lived connectors with a shared lifecycle:
- one-time OAuth connect
- encrypted token storage with refresh support
- initial backfill
- scheduled reconcile polling
- optional webhook fan-in
- normalized snapshot import through `@healthybob/importers`

WHOOP uses OAuth plus webhooks.

Oura uses OAuth plus refresh tokens and works well in a polling-first mode, so the basic Healthy Bob setup does not require Oura webhooks. Once the operator configures the Oura client ID and secret, the end-user flow is just connect once and let scheduled sync keep the account fresh.

## Environment

Required:
- `DEVICE_SYNC_VAULT_ROOT`
- `DEVICE_SYNC_PUBLIC_BASE_URL`
- `DEVICE_SYNC_SECRET`

At least one provider must be configured.

Common optional settings:
- `DEVICE_SYNC_PORT`
- `DEVICE_SYNC_HOST` (defaults to `127.0.0.1`)
- `DEVICE_SYNC_CONTROL_TOKEN` (defaults to `DEVICE_SYNC_SECRET` if omitted)
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

Legacy `HEALTHYBOB_*` env names remain accepted as compatibility aliases for now.

## Run

```bash
healthybob device daemon start --vault ./vault
```

Manual direct execution remains available:

```bash
node packages/device-syncd/dist/bin.js
```

The published bin name is also `healthybob-device-syncd`.

## Control-plane clients

- `vault-cli device ...` can auto-start and reuse this daemon for the selected vault, or it can target an explicit control plane through `DEVICE_SYNC_BASE_URL`
- `vault-cli` and `packages/web` authenticate local control routes with `DEVICE_SYNC_CONTROL_TOKEN` (or, for local bootstrap compatibility, `DEVICE_SYNC_SECRET`)
- `packages/web` can show provider/account status and redirect through this daemon for one-click auth
- cross-origin `returnTo` URLs are accepted only when their origin appears in `DEVICE_SYNC_ALLOWED_RETURN_ORIGINS`; relative paths remain allowed by default

## HTTP routes

Control routes: loopback-only plus `Authorization: Bearer <token>`
- `GET /healthz`
- `GET /providers`
- `GET /connect/:provider?returnTo=/settings/devices`
- `POST /providers/:provider/connect`
- `GET /accounts`
- `GET /accounts/:id`
- `POST /accounts/:id/reconcile`
- `POST /accounts/:id/disconnect`

Public routes: keep them on localhost unless you explicitly expose a separate callback/webhook listener
- `GET /oauth/:provider/callback`
- `POST /webhooks/:provider` for providers that support webhooks

## Notes for Oura

Healthy Bob's Oura connector is designed for the least-friction user path:
- the operator registers one Oura API application once
- users connect their Oura account through the normal OAuth consent flow
- `device-syncd` keeps the account alive with refresh tokens
- reconcile jobs poll recent windows so ongoing sync works even without webhook setup

That keeps the user-facing experience at connect once, then auto-sync while still fitting the same provider lifecycle used by WHOOP.
