# @healthybob/device-syncd

Standalone device sync runtime for HealthyBob.

What it does:
- serves a provider-agnostic local control plane for CLI and web auth flows
- owns OAuth connection state
- stores encrypted provider tokens in SQLite under `.runtime/device-syncd.sqlite`
- accepts provider webhooks when a provider supports them
- runs background backfill and reconcile jobs
- imports provider snapshots through `@healthybob/importers`

Current providers:
- WHOOP
- Oura

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
- `HEALTHYBOB_VAULT_ROOT`
- `HEALTHYBOB_DEVICE_SYNC_PUBLIC_BASE_URL`
- `HEALTHYBOB_DEVICE_SYNC_SECRET`

At least one provider must be configured.

Common optional settings:
- `HEALTHYBOB_DEVICE_SYNC_PORT`
- `HEALTHYBOB_DEVICE_SYNC_HOST`
- `HEALTHYBOB_DEVICE_SYNC_ALLOWED_RETURN_ORIGINS`
- `HEALTHYBOB_DEVICE_SYNC_STATE_DB_PATH`
- `HEALTHYBOB_DEVICE_SYNC_WORKER_POLL_MS`
- `HEALTHYBOB_DEVICE_SYNC_WORKER_BATCH_SIZE`
- `HEALTHYBOB_DEVICE_SYNC_SCHEDULER_POLL_MS`
- `HEALTHYBOB_DEVICE_SYNC_SESSION_TTL_MS`
- `HEALTHYBOB_DEVICE_SYNC_WORKER_LEASE_MS`

WHOOP settings:
- `HEALTHYBOB_WHOOP_CLIENT_ID`
- `HEALTHYBOB_WHOOP_CLIENT_SECRET`
- `HEALTHYBOB_WHOOP_BASE_URL`
- `HEALTHYBOB_WHOOP_SCOPES`
- `HEALTHYBOB_WHOOP_BACKFILL_DAYS`
- `HEALTHYBOB_WHOOP_RECONCILE_DAYS`
- `HEALTHYBOB_WHOOP_RECONCILE_INTERVAL_MS`
- `HEALTHYBOB_WHOOP_WEBHOOK_TIMESTAMP_TOLERANCE_MS`
- `HEALTHYBOB_WHOOP_REQUEST_TIMEOUT_MS`

Oura settings:
- `HEALTHYBOB_OURA_CLIENT_ID`
- `HEALTHYBOB_OURA_CLIENT_SECRET`
- `HEALTHYBOB_OURA_AUTH_BASE_URL`
- `HEALTHYBOB_OURA_API_BASE_URL`
- `HEALTHYBOB_OURA_SCOPES`
- `HEALTHYBOB_OURA_BACKFILL_DAYS`
- `HEALTHYBOB_OURA_RECONCILE_DAYS`
- `HEALTHYBOB_OURA_RECONCILE_INTERVAL_MS`
- `HEALTHYBOB_OURA_REQUEST_TIMEOUT_MS`

## Run

```bash
node packages/device-syncd/dist/bin.js
```

The published bin name is also `healthybob-device-syncd`.

## Control-plane clients

- `vault-cli device ...` uses this daemon through `HEALTHYBOB_DEVICE_SYNC_BASE_URL` or `http://127.0.0.1:8788`
- `packages/web` can show provider/account status and redirect through this daemon for one-click auth
- cross-origin `returnTo` URLs are accepted only when their origin appears in `HEALTHYBOB_DEVICE_SYNC_ALLOWED_RETURN_ORIGINS`; relative paths remain allowed by default

## HTTP routes

- `GET /healthz`
- `GET /providers`
- `GET /connect/:provider?returnTo=/settings/devices`
- `POST /providers/:provider/connect`
- `GET /oauth/:provider/callback`
- `POST /webhooks/:provider` for providers that support webhooks
- `GET /accounts`
- `GET /accounts/:id`
- `POST /accounts/:id/reconcile`
- `POST /accounts/:id/disconnect`

## Notes for Oura

Healthy Bob's Oura connector is designed for the least-friction user path:
- the operator registers one Oura API application once
- users connect their Oura account through the normal OAuth consent flow
- `device-syncd` keeps the account alive with refresh tokens
- reconcile jobs poll recent windows so ongoing sync works even without webhook setup

That keeps the user-facing experience at connect once, then auto-sync while still fitting the same provider lifecycle used by WHOOP.
