# @healthybob/device-syncd

Standalone device sync runtime for HealthyBob.

What it does:
- serves a provider-agnostic local control plane for CLI and web auth flows
- owns OAuth connection state
- stores encrypted provider tokens in SQLite under `.runtime/device-syncd.sqlite`
- accepts provider webhooks
- runs background backfill and reconcile jobs
- imports provider snapshots through `@healthybob/importers`

Current provider:
- WHOOP

## Environment

Required:
- `HEALTHYBOB_VAULT_ROOT`
- `HEALTHYBOB_DEVICE_SYNC_PUBLIC_BASE_URL`
- `HEALTHYBOB_DEVICE_SYNC_SECRET`
- `HEALTHYBOB_WHOOP_CLIENT_ID`
- `HEALTHYBOB_WHOOP_CLIENT_SECRET`

Common optional settings:
- `HEALTHYBOB_DEVICE_SYNC_PORT`
- `HEALTHYBOB_DEVICE_SYNC_HOST`
- `HEALTHYBOB_DEVICE_SYNC_ALLOWED_RETURN_ORIGINS`
- `HEALTHYBOB_DEVICE_SYNC_STATE_DB_PATH`
- `HEALTHYBOB_DEVICE_SYNC_WORKER_POLL_MS`
- `HEALTHYBOB_DEVICE_SYNC_WORKER_BATCH_SIZE`
- `HEALTHYBOB_DEVICE_SYNC_SCHEDULER_POLL_MS`
- `HEALTHYBOB_WHOOP_BACKFILL_DAYS`
- `HEALTHYBOB_WHOOP_RECONCILE_DAYS`
- `HEALTHYBOB_WHOOP_RECONCILE_INTERVAL_MS`

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
- `POST /webhooks/:provider`
- `GET /accounts`
- `GET /accounts/:id`
- `POST /accounts/:id/reconcile`
- `POST /accounts/:id/disconnect`
